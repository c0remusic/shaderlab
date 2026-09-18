/**
 * DÉGRADÉS DE PISTE DES CURSEURS — données de couleur du DOMAINE (ticket 08 de
 * `.scratch/lightroom-develop/`). Antoine, 2026-09-11 : « on a pas les couleurs
 * sur "température" par exemple comme sur lightroom ».
 *
 * ⚠️ POURQUOI CE FICHIER EST À PART, ET EXCLU DE `lint:tokens`. Les chaînes de
 * couleur ci-dessous NE SONT PAS des tokens de design : ce sont des DONNÉES —
 * les deux bouts perceptuels bleu/jaune de la Température, la couleur mesurée de
 * chaque bande HSL (`hslBandes.ts`), la roue de teintes des primaires. Aucune
 * variable `--token` ne les remplacerait, et les exprimer en `rgb(...)` /
 * `hsl(...)` fait justement ce que `lint:tokens` proscrit AILLEURS — poser une
 * couleur en dur. La dérogation est un EXCLUANT DE FICHIER dans
 * `scripts/lint-tokens.mjs` (même mécanisme que l'exclusion des fichiers de
 * test, pour la même raison : ces valeurs ne contournent aucun token). Garder
 * TOUTE couleur littérale du chantier ICI, jamais dans un module d'effet
 * scanné, est ce qui rend cette dérogation étroite et relisible.
 *
 * ⚠️ AFFICHAGE PUR. Rien de ce fichier n'atteint le shader : `labeled-slider`
 * pose ces dégradés sur la piste, le pouce par-dessus. `test:render` = zéro écart.
 *
 * Les couleurs des BANDES HSL sont DÉRIVÉES de `hslBandes.ts` par les fonctions
 * ci-dessous (une fonction de dérivation, pas 32 littéraux à tenir à jour) ;
 * seules les extrémités perceptuelles fixes (Température, Nuance, roue) sont
 * écrites à la main.
 */
import { HSL_BANDES, type HslBande } from "./hslBandes";
import { hsl2rgb } from "./hsl";

type Rgb = readonly [number, number, number];
export interface TrackGradient {
  stops: string[];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Triplet linéaire d'affichage 0..1 -> chaîne CSS `rgb(r, g, b)` en 0..255. */
function cssRgb(c: Rgb): string {
  const to255 = (x: number): number => Math.round(clamp01(x) * 255);
  return `rgb(${to255(c[0])}, ${to255(c[1])}, ${to255(c[2])})`;
}

/** Interpolation linéaire entre deux couleurs (fraction 0..1). */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Désature vers la luminance perçue, en gardant `keep` (0..1) de la chroma. */
function desaturate(c: Rgb, keep: number): Rgb {
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [y + (c[0] - y) * keep, y + (c[1] - y) * keep, y + (c[2] - y) * keep];
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [1, 1, 1];
const GRAY: Rgb = [0.5, 0.5, 0.5];

// ── EXTRÉMITÉS FIXES (mesurées / perceptuelles) ──────────────────────────────

/** Température : froid (−) à gauche = bleu, chaud (+) à droite = jaune. */
export const TEMPERATURE_GRADIENT: TrackGradient = {
  stops: [cssRgb([0.18, 0.42, 0.9]), cssRgb([0.93, 0.82, 0.28])],
};

/** Nuance : vert (−) à gauche, magenta (+) à droite — la balance des blancs
 *  relative de Lightroom. Réutilisé tel quel par la Nuance foncée de
 *  l'étalonnage si Antoine le veut (voir le rapport du ticket). */
export const NUANCE_GRADIENT: TrackGradient = {
  stops: [cssRgb([0.24, 0.68, 0.35]), cssRgb([0.82, 0.24, 0.82])],
};

/** Balayage de teinte (arc-en-ciel), pour la Vibrance et la Saturation globales
 *  de `reglagesDeBase` — Lightroom colore ces deux pistes ainsi (vérifié sur la
 *  capture de référence 1:1). */
export const RAINBOW_GRADIENT: TrackGradient = {
  stops: [0, 60, 120, 180, 240, 300, 360].map((h) => cssRgb(hsl2rgb(h / 360, 1, 0.5))),
};

// ── DÉRIVÉES DES BANDES HSL (`hslBandes.ts`) ─────────────────────────────────

const bandeIndex = (id: HslBande["id"]): number => HSL_BANDES.findIndex((b) => b.id === id);

/** Couleur PLEINE d'une bande, en CSS — la pastille de sélection du mélangeur
 *  (ticket 07, item 5).
 *
 *  ⚠️ Elle vit ICI et non dans le composant, pour que la pastille et la piste
 *  colorée du même curseur sortent du MÊME `cssRgb(HSL_BANDES[i].rgb)`. Deux
 *  dérivations séparées auraient dérivé l'une de l'autre au premier
 *  recalibrage — et la table est REGÉNÉRÉE par `assets/calibrer-hsl.py`, donc
 *  ce recalibrage arrivera. */
export function hslBandeSwatch(id: HslBande["id"]): string {
  return cssRgb(HSL_BANDES[bandeIndex(id)].rgb);
}

/** Teinte d'une bande : voisine précédente → bande → voisine suivante (ex. bande
 *  rouge : magenta → rouge → orange), sur l'anneau des huit bandes. */
export function hslBandeHueGradient(id: HslBande["id"]): TrackGradient {
  const i = bandeIndex(id);
  const n = HSL_BANDES.length;
  return {
    stops: [
      cssRgb(HSL_BANDES[(i - 1 + n) % n].rgb),
      cssRgb(HSL_BANDES[i].rgb),
      cssRgb(HSL_BANDES[(i + 1) % n].rgb),
    ],
  };
}

/** Saturation d'une bande : gris → couleur de la bande. */
export function hslBandeSatGradient(id: HslBande["id"]): TrackGradient {
  return { stops: [cssRgb(GRAY), cssRgb(HSL_BANDES[bandeIndex(id)].rgb)] };
}

/** Luminance d'une bande : sombre teinté → clair teinté de la bande. */
export function hslBandeLumGradient(id: HslBande["id"]): TrackGradient {
  const c = HSL_BANDES[bandeIndex(id)].rgb;
  return { stops: [cssRgb(mix(c, BLACK, 0.7)), cssRgb(mix(c, WHITE, 0.7))] };
}

/** Mélange Noir et blanc d'une bande : sombre → clair, très désaturé mais TEINTÉ
 *  de la bande — assez pour distinguer les huit curseurs sans prétendre montrer
 *  une couleur (le rendu N&B est achromatique). Décision d'affichage : le
 *  panneau N&B de Lightroom n'est PAS dans les captures de référence (ticket 07),
 *  ce dégradé dérive donc de la table plutôt que de la mesure. */
export function hslBandeGrayGradient(id: HslBande["id"]): TrackGradient {
  const g = desaturate(HSL_BANDES[bandeIndex(id)].rgb, 0.35);
  return { stops: [cssRgb(mix(g, BLACK, 0.6)), cssRgb(mix(g, WHITE, 0.6))] };
}

// ── ÉTALONNAGE (roue des primaires) ──────────────────────────────────────────

const PRIMARY_HUE: Record<"red" | "green" | "blue", number> = { red: 0, green: 120, blue: 240 };

/** Teinte d'une primaire d'étalonnage : dégradé de teinte autour de la primaire,
 *  ±30° (la course réelle du curseur, `HUE_DEGREES_PER_UNIT`·100 ≈ 30°). C'est
 *  une approximation en teinte HSL du pivotement OKLab de l'effet — un indice de
 *  lecture, pas l'opérateur exact. */
export function etalonnagePrimaryHueGradient(primary: "red" | "green" | "blue"): TrackGradient {
  const h = PRIMARY_HUE[primary];
  const at = (deg: number): string => cssRgb(hsl2rgb((((deg % 360) + 360) % 360) / 360, 1, 0.5));
  return { stops: [at(h - 30), at(h), at(h + 30)] };
}

/** Saturation d'une primaire d'étalonnage : gris → primaire pure. */
export function etalonnagePrimarySatGradient(primary: "red" | "green" | "blue"): TrackGradient {
  return { stops: [cssRgb(GRAY), cssRgb(hsl2rgb(PRIMARY_HUE[primary] / 360, 1, 0.5))] };
}

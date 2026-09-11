/**
 * TABLE DE CALIBRATION DES BANDES HSL — le module `hsl` de l'étage de
 * développement (ticket 05 de `.scratch/lightroom-develop/`).
 *
 * ✅ CALIBRÉE SUR LIGHTROOM 14.5, PLUS PROVISOIRE. Les exports du plugin
 * `assets/shaderlab-dump.lrdevplugin` existent désormais (146 mesures dans
 * `research/mesures/*.json`, résumées dans `research/03-…` et `research/04-hsl-
 * profils-mesures.md`). `assets/calibrer-hsl.py` ajuste ces nombres par moindres
 * carrés — dans les termes MÊMES du forward-model, pas une formule fermée — et
 * imprime cette table avec l'écart résiduel par courbe. La calibration se
 * RELANCE (`python assets/calibrer-hsl.py`), elle ne se réécrit pas à la main.
 *
 * ── COMMENT LES BANDES SONT DÉFINIES, ET POURQUOI SANS `atan2` ────────────────
 *
 * Une bande est une DIRECTION dans le plan chromatique (a,b) d'OKLab, pas un
 * angle HSL. `rgb` est la COULEUR REPRÉSENTATIVE de la bande (en sRGB 0..1, à
 * sat 1 / L 0.5), soit le CENTRE mesuré : `hslDevelop.ts` la convertit une fois
 * en linéaire puis en OKLab et en tire le vecteur unitaire (a,b) de la bande. Le
 * poids d'un pixel sur une bande est ensuite le COSINUS de l'écart angulaire — un
 * simple produit scalaire `(a·ca + b·cb)/|ab|` — passé dans une gaussienne
 * (`acos` de l'écart, SÛR sur Dawn ; c'est `atan2` qui ment au 3ᵉ quadrant,
 * ticket 04, et il n'apparaît nulle part ici). L'angle absolu du pixel n'est
 * jamais calculé : on ne compare que des directions.
 *
 * ── LARGEUR ASYMÉTRIQUE (DEUX σ) ──────────────────────────────────────────────
 *
 * Le profil mesuré de plusieurs bandes (Vert, Bleu, Violet, Aqua) est franchement
 * ASYMÉTRIQUE autour de son centre — la bande déborde plus d'un côté que de
 * l'autre. La gaussienne du poids porte donc DEUX demi-largeurs, `sigmaLeftDeg` et
 * `sigmaRightDeg`, et le côté se lit au SIGNE du produit vectoriel
 * `a·cb − b·ca` (sans `atan2`, un simple `select`). Une bande symétrique porte
 * `sigmaLeftDeg == sigmaRightDeg` (Rouge, Magenta).
 *
 * Les coefficients disent ce qu'un curseur à ±100 produit sur un pixel PUR de la
 * bande (poids ≈ 1), tous ajustés sur la mesure :
 *  - `amplitudeDeg` : rotation de teinte (degrés dans le plan OKLab) à Teinte +100 ;
 *  - `satK` : Saturation multiplie la chroma par `1 + poids·(sat/100)·satK` —
 *    borné à 1 (au-delà, −100 inverserait la chroma vers la complémentaire) ;
 *  - `lumK` : Luminance multiplie L par `1 + poids·(lum/100)·lumK` (perceptuel,
 *    teinte intacte). UN seul k par bande : Lightroom éclaircit et assombrit de
 *    façon asymétrique, on prend le meilleur k commun (écart p/m noté au ticket) ;
 *  - `grayK` : en Noir et blanc, L de sortie = `L·(1 + poids·(gray/100)·grayK)`.
 *    ⚠️ COLONNE LA MOINS SÛRE : dérivée par différence croisée `hsl2-gris-*` vs
 *    `nb`, sur une série 2 contaminée par un virage SplitToning et bornée par le
 *    plafond de L pour les bandes déjà claires (Jaune/Magenta saturent la
 *    recherche). Seuls Rouge et Bleu sont exercés par une référence.
 */
export interface HslBande {
  /** Identifiant stable de la bande (clé de libellé, ordre du panneau). */
  id: "red" | "orange" | "yellow" | "green" | "aqua" | "blue" | "purple" | "magenta";
  /** Couleur représentative (centre mesuré), sRGB 0..1 — définit sa direction (a,b) en OKLab. */
  rgb: readonly [number, number, number];
  /** Rotation de teinte (°, plan OKLab) sur un pixel pur de la bande à Teinte +100. */
  amplitudeDeg: number;
  /** Demi-largeur gaussienne (°, plan OKLab) du côté `a·cb − b·ca < 0` du centre. */
  sigmaLeftDeg: number;
  /** Demi-largeur gaussienne (°, plan OKLab) du côté `a·cb − b·ca ≥ 0` du centre. */
  sigmaRightDeg: number;
  /** Coefficient de Saturation : chroma ×= 1 + poids·(sat/100)·satK. */
  satK: number;
  /** Coefficient de Luminance : L ×= 1 + poids·(lum/100)·lumK. */
  lumK: number;
  /** Coefficient de Mélange N&B : L ×= 1 + poids·(gray/100)·grayK. */
  grayK: number;
}

/** Chroma OKLab de la PORTE anti-gris : le poids de toute bande est multiplié par
 *  `smoothstep(0, HSL_CHROMA_REF, chroma)`, donc un gris (chroma nulle) ne bouge
 *  à AUCUN réglage, et une couleur pâle bouge moins qu'une couleur vive — ce que
 *  Lightroom fait, mesurable sur les bandes de luminosité de la mire. Le balayage
 *  de calibration est à sat 100 %, il ne contraint pas cette porte : laissée à
 *  0,05 (choix de conception, pas une valeur mesurée). */
export const HSL_CHROMA_REF = 0.05;

/** Les huit bandes, dans l'ordre de Lightroom (Rouge → Magenta). Table calibrée
 *  sur Lightroom 14.5 par `assets/calibrer-hsl.py` (moindres carrés forward-model).
 *  Résidus par courbe (deg de teinte / points de sat·lum HLS) dans le ticket 05 et
 *  dans `assets/hsl-calibration.json`. RELANCER le script plutôt que d'éditer à la main. */
export const HSL_BANDES: readonly HslBande[] = [
  { id: "red", rgb: [1.0, 0.0, 0.2167], amplitudeDeg: 46, sigmaLeftDeg: 18, sigmaRightDeg: 23, satK: 0.84, lumK: 0.67, grayK: 0.54 },
  { id: "orange", rgb: [1.0, 0.5, 0.0], amplitudeDeg: 52, sigmaLeftDeg: 26, sigmaRightDeg: 23, satK: 0.88, lumK: 0.68, grayK: 1.42 },
  { id: "yellow", rgb: [1.0, 0.8667, 0.0], amplitudeDeg: 36, sigmaLeftDeg: 18, sigmaRightDeg: 28, satK: 0.98, lumK: 0.47, grayK: 2.0 },
  { id: "green", rgb: [0.4417, 1.0, 0.0], amplitudeDeg: 82, sigmaLeftDeg: 10, sigmaRightDeg: 17, satK: 1.0, lumK: 0.49, grayK: 0.09 },
  { id: "aqua", rgb: [0.0, 1.0, 0.8], amplitudeDeg: 24, sigmaLeftDeg: 41, sigmaRightDeg: 13, satK: 0.92, lumK: 0.4, grayK: 0.2 },
  { id: "blue", rgb: [0.0, 0.4667, 1.0], amplitudeDeg: 66, sigmaLeftDeg: 41, sigmaRightDeg: 52, satK: 0.62, lumK: 0.47, grayK: 0.93 },
  { id: "purple", rgb: [0.9667, 0.0, 1.0], amplitudeDeg: 52, sigmaLeftDeg: 9, sigmaRightDeg: 78, satK: 0.52, lumK: 0.39, grayK: 1.46 },
  { id: "magenta", rgb: [1.0, 0.0, 0.6667], amplitudeDeg: 30, sigmaLeftDeg: 15, sigmaRightDeg: 15, satK: 0.71, lumK: 0.62, grayK: 2.0 },
];

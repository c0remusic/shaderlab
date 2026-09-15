/**
 * TABLE D'AMPLITUDES DU COLOR GRADING — le module `colorGrading` de l'étage de
 * développement (ticket 06 de `.scratch/lightroom-develop/`).
 *
 * MÊME CONTRAT QUE `hslBandes.ts` : le module (twin TS + génération WGSL) LIT cette
 * table, et `assets/calibrer-grading.py` la RÉÉCRIT depuis les mesures Lightroom.
 * On relance le script, on n'édite pas les valeurs mesurées à la main.
 *
 * ── CE QUI EST CALIBRÉ SUR LIGHTROOM 14.5, ET CE QUI NE PEUT PAS L'ÊTRE ────────
 *
 * ⚠️ DEUX des quatre roues ne sont PAS mesurables dans les exports, pour une
 * raison de PLOMBERIE Lightroom trouvée sur pièce le 2026-09-11. Les teintes
 * Ombres / Hautes lumières du Color Grading vivent, dans le moteur de Lightroom,
 * sous les clés HÉRITÉES `SplitToningShadow*` / `SplitToningHighlight*`, PAS sous
 * `ColorGradeShadowHue` / `ColorGradeHighlightHue`. Le plugin de mesure a écrit
 * ces dernières : Lightroom les a ignorées, et `grading-ombres-bleu` (220°/60) et
 * `grading-hl-orange` (40°/60) rendent une rampe de gris STRICTEMENT NEUTRE dans
 * les exports (dch = 0 à tous les niveaux, vérifié en OKLab). Idem `Balance` et
 * `Fusion`, dont l'effet ne se lit que sur une teinte présente. Ce qui reste
 * MESURABLE (clés `ColorGrade*` réelles) :
 *
 *  - MÉDIANS (`grading-moyens-vert`, MidtoneSat 60) : une cloche de chroma sur la
 *    luminance, centre et largeur ajustés. → `midCenter`, `midSigma`, `chromaK`.
 *  - GLOBAL luminance (`grading-global-lum-p50`, GlobalLum +50) : un lift en cloche
 *    sur la luminance. → `lumK`.
 *
 * `chromaK` (chroma ajoutée à sat 100, poids 1) et `lumK` (lift de L à lum 100,
 * poids 1), tirés des médians / du global, sont RÉUTILISÉS pour les quatre roues :
 * Lightroom applique UN seul modèle de mélange, donc l'amplitude d'une roue ne
 * dépend pas de la plage. Les PROFILS de poids des Ombres / Hautes lumières, le
 * geste de `Balance` et l'ouverture de `Fusion` sont MODÉLISÉS (non mesurables
 * ici), bornés par le twin, et provisoires — même posture que le `grayK` du
 * ticket 05. Résidus et méthode : `assets/calibrer-grading.py`, rapport du 06.
 */
export interface ColorGradingCalibration {
  /** Chroma OKLab ajoutée par une roue à Saturation 100, poids de plage 1.
   *  CALIBRÉ sur `grading-moyens-vert` (médians vert, MidtoneSat 60). */
  chromaK: number;
  /** Décalage de L (OKLab) par une roue à Luminance 100, poids de plage 1.
   *  CALIBRÉ sur `grading-global-lum-p50` (GlobalLum +50). */
  lumK: number;
  /** Centre (L OKLab) de la cloche des tons moyens. CALIBRÉ (médians). */
  midCenter: number;
  /** Demi-largeur gaussienne (L OKLab) de la cloche des tons moyens à Fusion 50.
   *  CALIBRÉ (médians). */
  midSigma: number;
  /** Ce que Fusion ajoute/retire à `midSigma` (la cloche des moyens s'élargit avec
   *  la fusion). MODÉLISÉ. */
  midSoft: number;
  /** Déplacement des centres de plage par unité de Balance (−1..1) : +1 pousse la
   *  bascule vers les hautes lumières, −1 vers les ombres. MODÉLISÉ. */
  balanceShift: number;
  /** Balance — DEMI-COURSE du déplacement de la bascule, sur l'axe sRGB :
   *  `B = 0,5 − balanceMid · (balance/100)`. Mesuré par le croisement du duo, qui
   *  passe du niveau 128 à 25 (+100) et à 229 (−100) : un déplacement de 0,404 et
   *  0,396 en tonalité sRGB, symétrique à 2 % près. Sur l'axe L d'OKLab la même
   *  mesure donne 0,387 et 0,322, asymétrique à 20 % — c'est l'un des trois
   *  arguments indépendants qui désignent l'axe sRGB. */
  balanceMid: number;
  /** Fusion — PROFONDEUR du creux que le curseur ouvre autour de la bascule.
   *  ⚠️ Fusion ne fond pas les plages et ne les élargit pas : elle CREUSE une bande
   *  neutre autour du point de bascule, et c'est Fusion BASSE qui creuse le plus.
   *  Mesuré au niveau 160 : 0,0119 de chroma à Fusion 0, 0,0161 à 50, 0,0292 à 100.
   *  Sa course passe par la carte d'Adobe avec
   *  un `a` codé en dur (3/7), donc le défaut 50 vaut 0,30 de profondeur. */
  blendDepth: number;
}

/** Table calibrée / modélisée du Color Grading. RELANCER `assets/calibrer-grading.py`
 *  plutôt qu'éditer les champs mesurés (chromaK, lumK, midCenter, midSigma). */
export const COLOR_GRADING: ColorGradingCalibration = {
  chromaK: 0.164,
  lumK: 0.074,
  midCenter: 0.61,
  midSigma: 0.144,
  midSoft: 0.16,
  balanceShift: 0.3,
  balanceMid: 0.4,
  blendDepth: 0.8,
};

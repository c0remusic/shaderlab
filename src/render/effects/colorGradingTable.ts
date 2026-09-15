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
  /** CONTRASTE des deux plages — l'exposant de la rampe : `ws = (1−alpha)^g · cov`
   *  et `wh = alpha^g · cov`. À 1 c'est la rampe nue, et le point de bascule ne
   *  bouge pas quel que soit `g` : seule la RAIDEUR du partage change.
   *
   *  Il existe parce que le partage MESURÉ est bien plus raide que la rampe nue :
   *  à tonalité 0,314 la part des hautes lumières vaut 0,153 (nous : 0,314), à
   *  0,690 elle vaut 0,888 (nous : 0,690). Une homographie — la forme d'Adobe,
   *  `divMap` — ne peut PAS produire cette S : elle est monotone et cloue les
   *  bouts, mais ne s'infléchit pas deux fois. L'exposant, si.
   *
   *  ⚠️ CE N'EST DONC PAS LA FORME DU BINAIRE, c'est une forme qui reproduit sa
   *  mesure. À reprendre si le kernel `cr_stage_SplitTone` devient lisible. */
  rangeContrast: number;
}

/** Table calibrée / modélisée du Color Grading. RELANCER `assets/calibrer-grading.py`
 *  plutôt qu'éditer les champs mesurés (chromaK, lumK, midCenter, midSigma).
 *
 *  ── `rangeContrast` : AJUSTÉ, PUIS VALIDÉ EN CROISÉ ──────────────────────────
 *
 *  Une constante, ajustée sur une grille (optimum INTÉRIEUR, vallée douce). Les
 *  trois chiffres bougent dans le même sens, ce qui est ce qui l'a fait retenir :
 *   - écart aux treize mesures de virage : **4,295 → 4,167 niveaux** ;
 *   - niveaux de rampe écrasés à blanc pur à `Luminance des hautes lumières` +50 :
 *     **5 → 4** (et 8 → 7 à +100) — le raidissement RETIRE du poids au ras du
 *     blanc, donc il soulage le défaut que `appliqueLum` corrige ;
 *   - chroma d'un gris moyen sous virage bleu des ombres : **0,0216 → 0,0143**,
 *     contre **0,0151** mesurés chez Lightroom — 43 % d'écart ramenés à 5 %.
 *
 *  Ce qui le sauve du soupçon de sur-ajustement n'est pas le compte de paramètres,
 *  c'est la validation croisée PAR RÉGLAGE — ajuster sur un sous-ensemble, lire
 *  l'erreur sur des scènes qui n'ont servi à rien : ajusté sur les OMBRES seules,
 *  il améliore les HAUTES lumières (2,28 → 1,09) ; ajusté sur les HAUTES seules, il
 *  améliore les OMBRES (2,50 → 0,85) et les deux jeux disjoints désignent le MÊME
 *  optimum ; ajusté sur les luminances, il améliore les scènes de TEINTE (5,84 →
 *  5,56), qui n'ont servi à aucun ajustement.
 *
 *  ⚠️ UNE SECONDE CONSTANTE A ÉTÉ ESSAYÉE PUIS REFUSÉE, et le motif vaut d'être
 *  gardé : une amplitude de luminance séparée pour les deux plages (les mesures la
 *  réclament — les roues de plage demandent ~1,8 fois l'amplitude nominale, les
 *  deux roues sur lesquelles `lumK` est calibré tombent juste). Elle gagne 0,4
 *  niveau d'écart de plus (4,17 → 3,76) et fait passer l'écrasement de **4 à 9
 *  niveaux**. Échanger un défaut VISIBLE contre un dixième de niveau sur une mire
 *  est le mauvais sens du troc : le plafond n'est pas l'amplitude, c'est la forme
 *  du poids au ras du blanc, qui monte encore là où la mesure retombe.
 *
 *  ⚠️ Et le verdict hors échantillon (balayages de teinte) ne tranche PAS ici : la
 *  hausse qu'il montrait pour la variante à deux constantes était ENTIÈRE sur les
 *  deux balayages dont 100 % des entrées ont déjà un canal à 1,0 — élever la
 *  luminance y sort du gamut par construction, donc on y compare deux politiques
 *  d'écrêtage, pas deux formes de poids. */
export const COLOR_GRADING: ColorGradingCalibration = {
  chromaK: 0.164,
  lumK: 0.074,
  midCenter: 0.61,
  midSigma: 0.144,
  midSoft: 0.16,
  balanceShift: 0.3,
  balanceMid: 0.4,
  blendDepth: 0.8,
  rangeContrast: 1.6,
};

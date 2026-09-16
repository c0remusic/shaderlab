/**
 * TABLE DE CALIBRATION DU TON — le module `reglagesDeBase` de l'ÉTAGE de
 * développement (ticket 02 de `.scratch/lightroom-develop/`).
 *
 * ✅ CALIBRÉE SUR LIGHTROOM 14.5 (rampes MESURÉES, `research/mesures/*.json`, clé
 * `rampe` : sortie sRGB 0..255 pour l'entrée sRGB 0..255). Même contrat que
 * `hslBandes.ts` : le module (twin CPU + WGSL) et le test LISENT cette table, le
 * script `assets/calibrer-ton.py` la RÉÉCRIT par moindres carrés (grille + raffinage,
 * forward-model exact). La calibration se RELANCE (`python assets/calibrer-ton.py`),
 * elle ne se réécrit pas à la main. Chaque constante est sur sa PROPRE ligne
 * `clé: valeur,` pour que le script la remplace par ancre exacte (jamais un splice
 * par indices — CLAUDE.md).
 *
 * ── CE QUE CHAQUE CONSTANTE PILOTE, ET LA FORME QU'ELLE HABILLE ───────────────
 *
 * Toutes les formes du ton sont ANCRÉES aux extrémités (0→0 et 1→1) comme
 * Lightroom : un curseur de ton ne déplace jamais le noir ou le blanc PURS. C'est
 * la correction du 2026-09-12 (Antoine : « contraste et luminosité rendent un peu
 * bizarre ») — l'ancien contraste effondrait les extrêmes (−100 amenait le noir à
 * 128), ombres/noirs montaient le noir pur.
 *
 *  - EXPOSITION — gamma PERCEPTUEL ancré, UNIFIÉ aux deux signes :
 *    `s' = 1 − (1−s)^γ`, `γ = exp(expoG·EV)`. γ=1 à EV=0 → identité ; γ>1 éclaircit,
 *    γ<1 assombrit, et le blanc PUR est tenu à tout EV. ⚠️ ÉCART au modèle « gain
 *    linéaire 2^EV » du ticket : per-canal perceptuel, ce qui reproduit les rampes
 *    mesurées (Exposition +1 suit `1−(1−s)^1.8`) là où un gain 2^EV clippe les
 *    hautes lumières. L'exposition n'apparaît dans AUCUNE référence couleur, seulement
 *    sur la rampe grise. Écart RÉSIDUEL irréductible : Lightroom LÂCHE le blanc à
 *    −2 IL (255→197), aucune forme qui tient le blanc ne le reproduit — noté au ticket.
 *  - CONTRASTE — gamma double PIVOTÉ, ancré en 0 / pivot / 1 : sous le pivot
 *    `out = pv·(s/pv)^γ`, au-dessus `out = 1 − (1−pv)·((1−s)/(1−pv))^γ`,
 *    `γ = exp(contrastG·(contraste/100))`. γ>1 (contraste +) creuse autour du pivot,
 *    γ<1 (contraste −) aplatit — les DEUX sens, là où une sigmoïde re-normalisée
 *    reste en S dans les deux (ne réduit jamais le contraste). Lightroom pivote vers
 *    0,58 (pas 0,5).
 *  - OMBRES / HAUTES LUMIÈRES — lift de RÉGION pondéré par la luminance FLOUTÉE
 *    (`sBlur`, locale sur une vraie image ; = le pixel sur une rampe) :
 *    `delta = (curseur/100)·amt·bump(sBlur, center, kappa)`. `bump` est une cloche
 *    bêta normalisée (pic 1 au mode `center`, NULLE en 0 et en 1 → extrémités tenues).
 *  - NOIRS / BLANCS — même cloche, mais opérateurs PONCTUELS (sur le pixel `s`),
 *    centrés au ras du noir (Noirs) et du blanc (Blancs).
 *  - AMPLITUDE PAR SIGNE (`amtPos` / `amtNeg`) — Lightroom est ASYMÉTRIQUE : Ombres
 *    +100 lève bien plus fort que −100 n'assombrit (16→104 contre 16→1), Noirs −100
 *    écrase bien plus que +100 ne lève. Une amplitude unique ne peut pas fitter les
 *    deux ; `amtPos` sert quand le curseur est > 0, `amtNeg` quand il est < 0. La
 *    FORME de la cloche (center, kappa) est partagée.
 *  - COURBE PARAMÉTRIQUE — `curveAmt` = lift perceptuel maximal d'une région à
 *    |100| ; `curveWin` = demi-largeur des transitions cosinus entre régions.
 *
 * `bump(v,c,k) = v^(k·c)·(1−v)^(k·(1−c)) / peak`, `peak = c^(k·c)·(1−c)^(k·(1−c))`.
 * Le mode de la cloche est EXACTEMENT `c` ; `k` la resserre (k grand = étroite).
 */
/** Un point de rupture de la loi d'un curseur de balance des blancs : la DOSE
 *  mesurée (0..100) et les gains linéaires [R,G,B] qu'elle produit. La loi
 *  s'interpole entre ces points, ancrée à gain 1 en dose 0. */
export interface WbStep {
  dose: number;
  /** EXPOSANT par canal [R,G,B] du gamma ancré `1−(1−s)^γ`, en espace sRGB.
   *  ⚠️ C'était un GAIN multiplicatif en lumière linéaire jusqu'au 2026-09-16 :
   *  un gain SATURE le canal poussé, et il saturait dès les réglages doux. Le
   *  gamma tient 0 et 1 par construction, donc il comprime comme Lightroom. */
  gamma: number[];
}

export interface ReglagesDeBaseTable {
  /** Balance des blancs — gains linéaires par canal [R,G,B] PAR DOSE, branche
   *  Température POSITIVE. Appliqués SANS renormalisation : Lightroom règle la WB
   *  en espace CAMÉRA et ne préserve pas la luminance (les deux extrêmes
   *  éclaircissent).
   *
   *  ⚠️ LA LOI DU CURSEUR N'EST PAS PROPORTIONNELLE À LA DOSE, et le supposer
   *  coûtait cher au milieu de la course : à mi-course Lightroom n'a fait qu'une
   *  fraction du chemin, variable selon l'axe et le canal. D'où les points de
   *  rupture mesurés plutôt qu'un gain unique mis à l'échelle. Écart moyen aux
   *  dix mesures de balance des blancs, recalculé sur `rampe_rgb` de `temoin3` :
   *  10,07 → 8,62 niveaux, tout le gain venant des doses intermédiaires
   *  (nuance +50 : 11,1 → 4,0 ; nuance −50 : 8,2 → 2,6 ; température +25 :
   *  6,4 → 4,9). Les extrêmes ne bougent pas, par construction.
   *
   *  ⚠️ CE QUE CETTE TABLE NE PEUT PAS CORRIGER : le gain CONSTANT par canal est
   *  lui-même la mauvaise forme. Mesuré, le gain LOCAL de Lightroom dépend du
   *  niveau (environ 6,7 à v=32, 3,9 à v=128, ~1 au blanc) — il s'efface vers les
   *  hautes lumières, ce qu'un scalaire ne sait pas faire. Aucune valeur de cette
   *  table ne descendra donc sous un plancher d'environ 7 niveaux. C'est un
   *  chantier de forme, pas de constante. */
  wbTempPos: WbStep[];
  /** Balance des blancs — gains [R,G,B] par dose, branche Température NÉGATIVE.
   *  ⚠️ UNE SEULE DOSE ICI, DÉLIBÉRÉMENT : la loi reste linéaire sur cette branche.
   *  Les doses intermédiaires mesurées (−25, −75) ont été ÉCARTÉES par la
   *  contre-expertise — `temperature-m50` manque au milieu du retournement, la
   *  validation croisée sort pire que le statu quo (18,1 contre 17,0), et le canal
   *  bleu de `temperature-m100` est écrêté sur plus des deux tiers de la rampe,
   *  donc son gain n'est pas identifiable (le bassin est plat de 25 à 40). */
  wbTempNeg: WbStep[];
  /** Balance des blancs — gains [R,G,B] par dose, branche Nuance POSITIVE. */
  wbTintPos: WbStep[];
  /** Balance des blancs — gains [R,G,B] par dose, branche Nuance NÉGATIVE. */
  wbTintNeg: WbStep[];
  /** Exposition — coefficient de γ : `γ = exp(expoG·EV)`. */
  expoG: number;
  /** Contraste — coefficient de γ : `γ = exp(contrastG·(contraste/100))`. */
  contrastG: number;
  /** Contraste — pivot (sRGB, 0..1). */
  contrastPivot: number;
  /** Ombres — amplitude du lift de région à +100. */
  shadowAmtPos: number;
  /** Ombres — amplitude à −100. */
  shadowAmtNeg: number;
  /** Ombres — mode de la cloche (sRGB, 0..1). */
  shadowCenter: number;
  /** Ombres — concentration de la cloche (grand = étroite). */
  shadowKappa: number;
  /** Hautes lumières — amplitude à +100. */
  highlightAmtPos: number;
  /** Hautes lumières — amplitude à −100. */
  highlightAmtNeg: number;
  /** Hautes lumières — mode de la cloche. */
  highlightCenter: number;
  /** Hautes lumières — concentration de la cloche. */
  highlightKappa: number;
  /** Noirs — amplitude ponctuelle à +100. */
  blackAmtPos: number;
  /** Noirs — amplitude ponctuelle à −100. */
  blackAmtNeg: number;
  /** Noirs — mode de la cloche (au ras du noir). */
  blackCenter: number;
  /** Noirs — concentration de la cloche. */
  blackKappa: number;
  /** Blancs — amplitude ponctuelle à +100. */
  whiteAmtPos: number;
  /** Blancs — amplitude ponctuelle à −100. */
  whiteAmtNeg: number;
  /** Blancs — mode de la cloche (au ras du blanc). */
  whiteCenter: number;
  /** Blancs — concentration de la cloche. */
  whiteKappa: number;
  /** Courbe paramétrique — lift perceptuel maximal d'une région à |100|. */
  curveAmt: number;
  /** Courbe paramétrique — demi-largeur des transitions cosinus (perceptuel). */
  curveWin: number;
  /** Voile (positif = retrait) — force de la récupération type canal sombre à +100 :
   *  `J = s(1−ω)/(1−ω·s)`, `ω = dehazeOmega·(dehaze/100)`. Ancré (0→0, 1→1). Fitté
   *  sur la rampe `voile-p100`. */
  dehazeOmega: number;
  /** Voile (négatif = ajout) — hauteur du point d'airlight (relèvement du noir) à
   *  −100 : `J = 1−(1−a)·(1−s)^g`, `a = dehazeAirlight·(−dehaze/100)`. Fitté sur `voile-m100`. */
  dehazeAirlight: number;
  /** Voile (négatif = ajout) — exposant de la remontée : `g = 1+(dehazeGamma−1)·(−dehaze/100)`. */
  dehazeGamma: number;
  /** Voile (négatif = ajout) — désaturation de la chroma OKLab à −100 (LR blanchit
   *  les couleurs saturées vers l'airlight). Fitté sur la colonne sat du `balayage` de `voile-m100`. */
  dehazeDesatK: number;
}

/** Table calibrée sur Lightroom 14.5 par `assets/calibrer-ton.py` (moindres carrés
 *  forward-model). Écarts par rampe dans le ticket 02 et imprimés par le script.
 *  RELANCER le script plutôt que d'éditer à la main. */
export const RB_TABLE: ReglagesDeBaseTable = {
  wbTempPos: [
    { dose: 25, gamma: [1.552, 1.282, 0.958] },
    { dose: 50, gamma: [2.228, 1.58, 0.927] },
    { dose: 75, gamma: [2.833, 1.837, 0.915] },
    { dose: 100, gamma: [3.3, 2.035, 0.91] },
  ],
  // ⚠️ TROIS DOSES ICI, contre une seule du temps des gains : la contre-expertise
  // du 2026-09-12 avait ÉCARTÉ les doses intermédiaires parce que la validation
  // croisée sortait pire que le statu quo. Ce verdict portait sur la forme GAIN,
  // où le canal bleu de `temperature-m100` est écrêté sur les deux tiers de la
  // rampe — un fit sur du plafond. Avec le gamma ancré, rien n'est écrêté et les
  // trois doses mesurées sont exploitables. ⚠️ `temperature-m50` manque toujours,
  // donc l'interpolation entre 25 et 75 n'est éprouvée par aucune mesure.
  wbTempNeg: [
    { dose: 25, gamma: [0.868, 1.09, 1.532] },
    { dose: 75, gamma: [0.973, 1.39, 4.702] },
    { dose: 100, gamma: [1.375, 1.655, 10.08] },
  ],
  wbTintPos: [
    { dose: 50, gamma: [1.195, 0.975, 1.373] },
    { dose: 100, gamma: [1.403, 0.975, 2.695] },
  ],
  wbTintNeg: [
    { dose: 50, gamma: [1.002, 1.323, 0.965] },
    { dose: 100, gamma: [0.782, 2.127, 0.932] },
  ],
  expoG: 0.57,
  contrastG: 0.5325,
  contrastPivot: 0.62,
  shadowAmtPos: 0.25,
  shadowAmtNeg: 0.2,
  shadowCenter: 0.2,
  shadowKappa: 1.5,
  highlightAmtPos: 0.13,
  highlightAmtNeg: 0.13,
  highlightCenter: 0.79,
  highlightKappa: 1.5,
  blackAmtPos: 0.09,
  blackAmtNeg: 0.19,
  blackCenter: 0.3,
  blackKappa: 2.875,
  whiteAmtPos: 0.2,
  whiteAmtNeg: 0.09,
  whiteCenter: 0.83,
  whiteKappa: 2.5,
  curveAmt: 0.26,
  curveWin: 0.26,
  dehazeOmega: 0.745,
  dehazeAirlight: 0.275,
  dehazeGamma: 2.65,
  dehazeDesatK: 0.6,
};

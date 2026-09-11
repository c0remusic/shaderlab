/**
 * TABLE DE CALIBRATION DES BANDES HSL — le module `hsl` de l'étage de
 * développement (ticket 05 de `.scratch/lightroom-develop/`).
 *
 * ⚠️ CETTE TABLE EST PROVISOIRE, ET C'EST DÉLIBÉRÉ. Le ticket 05 se bloque sur la
 * MESURE `research/03-courbes-lightroom-mesurees.md` : les centres, largeurs et
 * amplitudes réels des huit bandes de Lightroom se lisent sur le balayage de
 * teinte exporté par le plugin `assets/shaderlab-dump.lrdevplugin` (dossier
 * `Documents/shaderlab-lightroom-mesures/`). Au moment d'écrire ce module, ce
 * dossier N'EXISTE PAS : aucun export n'a été produit. Les valeurs ci-dessous
 * sont donc les valeurs USUELLES de Lightroom (Rouge 0°, Orange 30°, Jaune 60°,
 * Vert 120°, Turquoise 180°, Bleu 240°, Violet 270°, Magenta 300° en teinte HSL ;
 * recouvrement à mi-hauteur entre voisines ; ±100 de teinte ≈ ±30°).
 *
 * C'EST LE SEUL ÉCART AUTORISÉ À LA RÈGLE « NE PAS APPROXIMER » DU DÉPÔT, et il
 * l'est parce que la table est NOMMÉE, ISOLÉE, et que son remplacement est un
 * SCRIPT et non une réécriture : `assets/calibrer-hsl.py` ajuste ces nombres par
 * moindres carrés sur les exports dès qu'ils existent, et imprime la table à
 * coller ici avec l'écart résiduel. Tant que le dossier de mesures est vide, ce
 * module rend l'APPROXIMATION usuelle de Lightroom, pas Lightroom mesuré.
 *
 * ── COMMENT LES BANDES SONT DÉFINIES, ET POURQUOI SANS `atan2` ────────────────
 *
 * Une bande est une DIRECTION dans le plan chromatique (a,b) d'OKLab, pas un
 * angle HSL. `rgb` est une couleur PURE de la bande (en sRGB 0..1) ; `hsl.ts` la
 * convertit une fois en linéaire puis en OKLab et en tire le vecteur unitaire
 * (a,b) de la bande. Le poids d'un pixel sur une bande est ensuite le COSINUS de
 * l'écart angulaire — un simple produit scalaire `(a·ca + b·cb)/|ab|` — passé
 * dans une gaussienne (`acos` de l'écart, qui est SÛR sur Dawn ; c'est `atan2`
 * qui ment au 3ᵉ quadrant, ticket 04, et il n'apparaît nulle part ici). Ce que
 * `atan2` aurait servi — l'angle absolu du pixel — n'est jamais calculé : on ne
 * compare que des directions.
 *
 * Les coefficients disent ce qu'un curseur à ±100 produit sur un pixel PUR de la
 * bande (poids ≈ 1) :
 *  - `amplitudeDeg` : rotation de teinte (degrés dans le plan OKLab) à Teinte +100 ;
 *  - `satK` : Saturation multiplie la chroma par `1 + poids·(sat/100)·satK` — à
 *    `satK = 1`, Saturation −100 amène la chroma à 0 (désaturation totale de la
 *    bande) ;
 *  - `lumK` : Luminance multiplie L par `1 + poids·(lum/100)·lumK` (perceptuel,
 *    teinte intacte) ;
 *  - `grayK` : en Noir et blanc, L de sortie = `L·(1 + poids·(gray/100)·grayK)`.
 *
 * Le SIGNE de la rotation de teinte (sens de `amplitudeDeg`) est lui aussi
 * provisoire : Lightroom déplace le rouge vers l'orange à Teinte +100, mais le
 * sens exact en OKLab se lira sur `hsl-teinte-*-p100`. Noté dans le ticket.
 */
export interface HslBande {
  /** Identifiant stable de la bande (clé de libellé, ordre du panneau). */
  id: "red" | "orange" | "yellow" | "green" | "aqua" | "blue" | "purple" | "magenta";
  /** Couleur PURE de la bande, sRGB 0..1 — définit sa direction (a,b) en OKLab. */
  rgb: readonly [number, number, number];
  /** Rotation de teinte (°, plan OKLab) sur un pixel pur de la bande à Teinte +100. */
  amplitudeDeg: number;
  /** Coefficient de Saturation : chroma ×= 1 + poids·(sat/100)·satK. */
  satK: number;
  /** Coefficient de Luminance : L ×= 1 + poids·(lum/100)·lumK. */
  lumK: number;
  /** Coefficient de Mélange N&B : L ×= 1 + poids·(gray/100)·grayK. */
  grayK: number;
}

/** Demi-largeur gaussienne du poids de bande, en DEGRÉS du plan OKLab. Choisie
 *  pour que deux bandes voisines se recouvrent autour de la mi-hauteur (partition
 *  de l'unité approchée), donc une couleur entre deux bandes reçoit des deux.
 *  PROVISOIRE — la largeur réelle se lit sur le balayage de teinte. */
export const HSL_SIGMA_DEG = 25;

/** Chroma OKLab de la PORTE anti-gris : le poids de toute bande est multiplié par
 *  `smoothstep(0, HSL_CHROMA_REF, chroma)`, donc un gris (chroma nulle) ne bouge
 *  à AUCUN réglage, et une couleur pâle bouge moins qu'une couleur vive — ce que
 *  Lightroom fait, mesurable sur les bandes de luminosité de la mire. PROVISOIRE. */
export const HSL_CHROMA_REF = 0.05;

/** Les huit bandes, dans l'ordre de Lightroom (Rouge → Magenta). Les `rgb` sont
 *  les couleurs pures des teintes usuelles ; les coefficients sont provisoires
 *  (voir en-tête) et identiques d'une bande à l'autre tant qu'aucune mesure ne
 *  les sépare. */
export const HSL_BANDES: readonly HslBande[] = [
  { id: "red", rgb: [1, 0, 0], amplitudeDeg: 30, satK: 1, lumK: 0.5, grayK: 0.5 },
  { id: "orange", rgb: [1, 0.5, 0], amplitudeDeg: 30, satK: 1, lumK: 0.5, grayK: 0.5 },
  { id: "yellow", rgb: [1, 1, 0], amplitudeDeg: 30, satK: 1, lumK: 0.5, grayK: 0.5 },
  { id: "green", rgb: [0, 1, 0], amplitudeDeg: 30, satK: 1, lumK: 0.5, grayK: 0.5 },
  { id: "aqua", rgb: [0, 1, 1], amplitudeDeg: 30, satK: 1, lumK: 0.5, grayK: 0.5 },
  { id: "blue", rgb: [0, 0, 1], amplitudeDeg: 30, satK: 1, lumK: 0.5, grayK: 0.5 },
  { id: "purple", rgb: [0.5, 0, 1], amplitudeDeg: 30, satK: 1, lumK: 0.5, grayK: 0.5 },
  { id: "magenta", rgb: [1, 0, 1], amplitudeDeg: 30, satK: 1, lumK: 0.5, grayK: 0.5 },
];

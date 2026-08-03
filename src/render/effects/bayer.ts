/**
 * Matrice de Bayer 4x4 (dither ordonné) — elle casse les bandes franches d'une
 * quantification sèche sur un dégradé doux (ciel).
 *
 * Son appelant a changé le 2026-08-03 : elle a servi `posterize` de sa naissance
 * au retrait de celui-ci (ADR-0012), et sert désormais le style « Bayer fin » de
 * `dither`. Le fichier survit à l'effet parce que la matrice n'a jamais été une
 * pièce de `posterize` — c'est une matrice de seuils, et ce qu'on en fait est
 * une décision de l'appelant.
 *
 * Le seuil rendu par `bayerThreshold` vit dans [-0.5, 0.5) : multiplié par la
 * taille d'un palier et ajouté AVANT quantification, il décale chaque pixel
 * d'au plus un demi-palier — donc la frontière entre deux paliers devient un
 * motif fin réparti, jamais un décalage de plus d'un palier.
 *
 * Le motif ne dépend QUE de la position en pixels (pas du temps, pas d'un
 * bruit aléatoire) : stable d'une frame à l'autre, aucun scintillement.
 *
 * `BAYER4_WGSL` est généré à partir de `BAYER_4X4` — une seule source pour la
 * matrice, côté CPU comme côté GPU.
 */
export const BAYER_4X4: readonly number[] = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

/** Seuil de dither du pixel (x, y), dans [-0.5, 0.5). */
export function bayerThreshold(x: number, y: number): number {
  const idx = (((y % 4) + 4) % 4) * 4 + (((x % 4) + 4) % 4);
  return (BAYER_4X4[idx] + 0.5) / 16 - 0.5;
}

/** Spécification pure de la quantification dithérée du shader (un canal). */
export function ditheredQuantize(
  value: number,
  levels: number,
  x: number,
  y: number,
): number {
  const stepSize = 1 / (Math.max(levels, 2) - 1);
  const dithered = value + bayerThreshold(x, y) * stepSize;
  return Math.min(1, Math.max(0, Math.floor(dithered / stepSize + 0.5) * stepSize));
}

export const BAYER4_WGSL = `
var<private> BAYER4: array<f32, 16> = array<f32, 16>(${BAYER_4X4.map((v) => v.toFixed(1)).join(", ")});

fn bayerThreshold(px: vec2<u32>) -> f32 {
  let idx = (px.y % 4u) * 4u + (px.x % 4u);
  return (BAYER4[idx] + 0.5) / 16.0 - 0.5;
}
`;

/**
 * Matrice de Bayer 8x8, CONSTRUITE et non recopiée.
 *
 * D'où le besoin : la 4x4 n'offre que seize seuils. C'est assez pour casser la
 * frontière entre deux paliers d'une quantification à plusieurs niveaux — le
 * seul usage de la 4x4 jusqu'à `dither` — et nettement trop peu pour un tramage
 * à DEUX niveaux, où ces seize seuils sont
 * toute l'information disponible et où la trame se lit en blocs de 4x4. Or le
 * 1 bit est précisément ce que la fiche `Dither` expose (`Levels` descend à 2).
 *
 * La récurrence est celle de la construction classique :
 *
 *     M(2n) = [ 4·M(n) + 0   4·M(n) + 2 ]
 *             [ 4·M(n) + 3   4·M(n) + 1 ]
 *
 * Écrite plutôt que la table recopiée : soixante-quatre nombres saisis à la main
 * sont soixante-quatre occasions de faute, et une seule faute ne se verrait que
 * comme un pixel qui bascule au mauvais moment — invisible en relecture. Un test
 * vérifie que le résultat est bien une permutation de 0..63.
 */
function expandBayer(base: readonly number[], n: number): number[] {
  const taille = n * 2;
  const out = new Array<number>(taille * taille);
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      // Quadrant : haut-gauche 0, haut-droite 2, bas-gauche 3, bas-droite 1.
      const quadrant = y < n ? (x < n ? 0 : 2) : x < n ? 3 : 1;
      out[y * taille + x] = 4 * base[(y % n) * n + (x % n)] + quadrant;
    }
  }
  return out;
}

export const BAYER_8X8: readonly number[] = expandBayer(BAYER_4X4, 4);

export const BAYER8_WGSL = `
var<private> BAYER8: array<f32, 64> = array<f32, 64>(${BAYER_8X8.map((v) => v.toFixed(1)).join(", ")});

fn bayerThreshold8(px: vec2<u32>) -> f32 {
  let idx = (px.y % 8u) * 8u + (px.x % 8u);
  return (BAYER8[idx] + 0.5) / 64.0 - 0.5;
}
`;

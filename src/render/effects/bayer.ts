/**
 * Matrice de Bayer 4x4 (dither ordonné) — utilisée par `posterize` pour casser
 * les bandes franches d'une quantification sèche sur un dégradé doux (ciel).
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

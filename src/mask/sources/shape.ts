import type { MaskSourceModule } from "./types";

/**
 * Forme GÉOMÉTRIQUE (rectangle OU ellipse) : le marquee de Photoshop chez nous,
 * décidé au ticket 10 (grilling 2026-08-27) — la géométrie vit en SOURCE de
 * masque, pas en calque ni en outil. Masque borné par une boîte, avec feather
 * (adoucissement isotrope du bord) et invert. Paramètres sérialisés dans cet
 * ORDRE FIXE (contrat wgsl) :
 * `params[0]=x0, [1]=y0, [2]=x1, [3]=y1, [4]=feather, [5]=invert (0/1),
 *  [6]=mode (0 rectangle, 1 ellipse)`.
 *
 * ⚠️ **`mode` EST LE DERNIER, ET CE N'EST PAS UN DÉTAIL DE STYLE.** Le
 * résolveur sérialise `Object.keys(defaultParams)` DANS L'ORDRE
 * (`maskTextureResolver.ts`, `flatten`) : insérer une clé au milieu décalerait
 * tous les slots suivants d'un cran. Même patron que `gradient.ts` (linéaire /
 * radial) : ajouté à la fin, un masque enregistré avant l'ajout d'un futur
 * paramètre reçoit le défaut 0 et rend la forme d'avant, au bit près.
 *
 * LA BOÎTE EST DÉCRITE PAR SES DEUX COINS (`x0,y0` / `x1,y1`, coordonnées image
 * normalisées [0,1]), et non par un centre + demi-dimensions : c'est ce que
 * produira le tracé à la souris du ticket 12 (l'outil Forme pose deux points),
 * donc décrire la boîte ainsi dès maintenant évite une conversion à la
 * frontière. L'ordre des coins est libre — le shader prend `min`/`max`.
 * RECTANGLE et ELLIPSE PARTAGENT la même boîte : basculer de mode ne perd aucun
 * réglage, exactement comme gradient partage ses deux points entre linéaire et
 * radial.
 *
 * ⚠️ FORME ET FEATHER ISOTROPES SUR LA TOILE, pas dans l'espace UV. L'espace UV
 * n'est pas isotrope : une ellipse inscrite dans une boîte carrée EN UV sortirait
 * en ellipse aplatie sur toute toile non carrée, et le feather d'un rectangle
 * serait plus épais sur un axe que sur l'autre. Toutes les distances sont donc
 * mesurées dans un espace corrigé de l'aspect, `q = uv * ar` avec
 * `ar = vec2(maskDims.x/maskDims.y, 1)` — même correction et même raison d'être
 * que le radial de `gradient.ts` et que `uvSpace.ts` côté effets. `maskDims`
 * vient du DOCUMENT (le wrapper du résolveur), surtout pas de
 * `textureDimensions(srcColor)` : le résolveur y sert la photo la plus basse de
 * la pile, dont l'aspect diverge de la toile dès qu'une toile est créée à un
 * autre format (ADR-0007). Une boîte carrée SUR LA TOILE (donc dont les demi-
 * dimensions valent le même nombre de pixels sur les deux axes) rend alors un
 * cercle exact en mode ellipse.
 *
 * ⚠️ LE FEATHER DU RECTANGLE PASSE PAR UNE SDF DE BOÎTE, jamais par un produit
 * de deux smoothstep par axe : un produit adoucit deux fois aux coins et les
 * CREUSE (coins rentrés). La SDF `length(max(d,0)) + min(max(d.x,d.y),0)` donne
 * une distance signée uniforme au bord, coins compris — le feather y est une
 * bande d'épaisseur constante tout autour.
 */
export const shapeSource: MaskSourceModule = {
  id: "shape",
  name: "Forme",
  defaultParams: { x0: 0.25, y0: 0.3, x1: 0.75, y1: 0.7, feather: 0.05, invert: 0, mode: 0 },
  wgsl: `
fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32 {
  let p0 = vec2<f32>(params[0], params[1]);
  let p1 = vec2<f32>(params[2], params[3]);
  let feather = max(params[4], 0.0001);
  let invert = params[5];
  // ASPECT : on travaille dans un espace corrige ou les distances comptent en
  // pixels egaux sur les deux axes (fraction de la hauteur). maskDims est le
  // DOCUMENT, pas srcColor. Voir l'en-tete du module et gradient.ts.
  let ar = vec2<f32>(max(maskDims.x, 1.0) / max(maskDims.y, 1.0), 1.0);
  let lo = min(p0, p1) * ar;
  let hi = max(p0, p1) * ar;
  let center = (lo + hi) * 0.5;
  let half = max((hi - lo) * 0.5, vec2<f32>(0.0001, 0.0001));
  let q = uv * ar;
  // Distance signee au bord de la boite, par axe : negative dedans, positive
  // dehors sur chaque composante. Sert au rectangle ; l'ellipse la remplace.
  let d = abs(q - center) - half;
  var dist = 0.0;
  if (params[6] > 0.5) {
    // ELLIPSE. Rayon normalise, remis a l'echelle par min(half) : une boite
    // CARREE sur la toile (half.x == half.y) rend alors une SDF de cercle
    // exacte, donc un feather isotrope. Sur une boite non carree c'est une
    // approximation monotone de la SDF d'ellipse, suffisante pour un bord doux.
    let k = length((q - center) / half);
    dist = (k - 1.0) * min(half.x, half.y);
  } else {
    // RECTANGLE. SDF de boite : distance exterieure + distance interieure, une
    // seule bande adoucie. JAMAIS un produit de smoothstep par axe, qui
    // creuserait les coins.
    dist = length(max(d, vec2<f32>(0.0, 0.0))) + min(max(d.x, d.y), 0.0);
  }
  // Bande symetrique autour du bord (dist == 0) : a feather -> 0 c'est une
  // marche nette, la frontiere reste sur le bord de la boite.
  let value = 1.0 - smoothstep(-feather, feather, dist);
  return select(value, 1.0 - value, invert > 0.5);
}
`,
};

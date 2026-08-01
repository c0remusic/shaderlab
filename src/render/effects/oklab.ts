/**
 * OKLab / OKLCH — l'espace perceptuel de Björn Ottosson, et sa forme polaire.
 *
 * POURQUOI IL ENTRE DANS CE DÉPÔT. Le cahier de références du 2026-08-01 (§6)
 * relève que le choix d'espace de mélange est un contrôle RÉCURRENT chez Figma
 * et absent partout chez nous. Le besoin est réel et antérieur à la référence :
 * `gradientMap` documente déjà, dans son point 2, le défaut le plus
 * reconnaissable d'un dégradé raté — entre un bleu profond et un orange vif, le
 * milieu de rampe sort en gris boueux. Son correctif actuel est de mélanger en
 * sRGB plutôt qu'en linéaire, ce qui atténue le creux sans le supprimer :
 * l'espace sRGB n'est pas perceptuellement uniforme, et il fait toujours passer
 * une interpolation bleu→orange par une zone désaturée.
 *
 * OKLab supprime la cause. Un mélange y suit une droite dont les points
 * intermédiaires sont perçus régulièrement espacés, et un dégradé entre deux
 * couleurs saturées garde sa saturation au milieu. OKLCH va plus loin : en
 * coordonnées polaires, l'interpolation fait TOURNER la teinte au lieu de
 * traverser l'axe achromatique — c'est la différence entre un bleu qui devient
 * orange en passant par le gris et un bleu qui y va par le violet et le rouge.
 *
 * CE QUE CE MODULE N'EST PAS. Il ne touche pas à la chaîne colorimétrique du
 * projet (CLAUDE.md § Stack) : rien ici ne pose de gamma manuel sur un
 * échantillon d'image. Les conversions vont du LINÉAIRE au LINÉAIRE et
 * n'existent qu'entre les deux bouts d'un mélange — même contrat que
 * `srgbTransfer`, dont l'en-tête décrit la règle en détail.
 *
 * RACINE CUBIQUE SIGNÉE. `pow(x, 1/3)` rend NaN pour x < 0 en WGSL, et une
 * composante LMS peut passer sous zéro : les effets de ce dépôt autorisent des
 * couleurs hors gamut (les coefficients négatifs de `channelMixer`, le
 * plancher-mais-pas-de-plafond de sa sortie). `sign(x) * pow(abs(x), 1/3)` est
 * l'extension impaire de la racine cubique, celle qu'implémente `cbrtf` en C —
 * c'est la forme qu'utilise Ottosson, et elle rend la conversion réversible sur
 * tout l'axe réel au lieu de produire un pixel NaN qui contaminerait ensuite
 * toute la chaîne de fusion.
 *
 * Les variantes TS et WGSL implémentent la MÊME formule, sur le modèle de
 * `srgbTransfer`/`channelMixSpec` : les tests verrouillent les nombres côté TS.
 * Une matrice recopiée de travers ne se voit PAS à l'œil sur un rendu — elle
 * décale légèrement une teinte —, donc elle doit se voir en test.
 *
 * Source des matrices : Björn Ottosson, « A perceptual color space for image
 * processing » (bottosson.github.io/posts/oklab/), domaine public.
 */

type Rgb = readonly [number, number, number];
type Triple = [number, number, number];

/** Extension IMPAIRE de la racine cubique (voir l'en-tête) : définie et
 *  réversible pour les valeurs négatives, contrairement à `Math.cbrt` d'un
 *  `Math.pow(x, 1/3)` naïf. `Math.cbrt` la fournit déjà côté JS ; la fonction
 *  existe pour nommer l'invariant partagé avec la variante WGSL. */
function signedCbrt(x: number): number {
  return Math.cbrt(x);
}

/** sRGB LINÉAIRE -> OKLab (L, a, b). L'entrée est ce que rend `textureSample`
 *  sur une texture `-srgb`, pas une valeur de picker. */
export function linearSrgbToOklab(c: Rgb): Triple {
  const l = 0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2];
  const m = 0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2];
  const s = 0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2];
  const l_ = signedCbrt(l);
  const m_ = signedCbrt(m);
  const s_ = signedCbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/** OKLab -> sRGB LINÉAIRE. Ne borne RIEN : une couleur hors gamut reste hors
 *  gamut, et c'est l'appelant qui décide (l'écrêtage appartient à la cible, pas
 *  à une conversion — même raison que le « pas de plafond » de channelMixer). */
export function oklabToLinearSrgb(lab: Rgb): Triple {
  const l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  const m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  const s_ = lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2];
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLab -> OKLCH (L, chroma, teinte en TOURS 0..1). La teinte est en tours et
 *  non en radians ou en degrés parce que son seul usage est l'interpolation sur
 *  un cercle : en tours, le repli du plus court chemin s'écrit `h - round(h)`,
 *  sans constante d'angle à ressaisir de part et d'autre de la frontière
 *  TS/WGSL. */
export function oklabToOklch(lab: Rgb): Triple {
  const chroma = Math.hypot(lab[1], lab[2]);
  // atan2(0,0) vaut 0 : une couleur achromatique a une teinte arbitraire mais
  // définie, et son chroma nul la rend de toute façon sans effet au mélange.
  const hue = Math.atan2(lab[2], lab[1]) / (2 * Math.PI);
  return [lab[0], chroma, hue - Math.floor(hue)];
}

/** OKLCH (teinte en TOURS) -> OKLab. */
export function oklchToOklab(lch: Rgb): Triple {
  const angle = lch[2] * 2 * Math.PI;
  return [lch[0], lch[1] * Math.cos(angle), lch[1] * Math.sin(angle)];
}

/** Jumeau WGSL des quatre fonctions ci-dessus. Autonome (aucune dépendance à un
 *  autre bloc WGSL de ce dossier) — l'inclure suffit. */
export const OKLAB_WGSL = `
// Racine cubique SIGNÉE : \`pow\` rend NaN sous zéro, et une composante LMS peut
// y descendre sur une couleur hors gamut (channelMixer autorise des
// coefficients négatifs). Extension impaire, celle de \`cbrtf\` en C.
fn signed_cbrt(x: f32) -> f32 {
  return sign(x) * pow(abs(x), 1.0 / 3.0);
}

fn linear_srgb_to_oklab(c: vec3<f32>) -> vec3<f32> {
  let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  let l_ = signed_cbrt(l);
  let m_ = signed_cbrt(m);
  let s_ = signed_cbrt(s);
  return vec3<f32>(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  );
}

fn oklab_to_linear_srgb(lab: vec3<f32>) -> vec3<f32> {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  return vec3<f32>(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

// Teinte en TOURS (0..1), pas en radians : le plus court chemin sur le cercle
// s'y écrit \`h - round(h)\`, sans constante d'angle dupliquée.
fn oklab_to_oklch(lab: vec3<f32>) -> vec3<f32> {
  let chroma = length(lab.yz);
  let hue = atan2(lab.z, lab.y) / 6.283185307179586;
  return vec3<f32>(lab.x, chroma, fract(hue));
}

fn oklch_to_oklab(lch: vec3<f32>) -> vec3<f32> {
  let angle = lch.z * 6.283185307179586;
  return vec3<f32>(lch.x, lch.y * cos(angle), lch.y * sin(angle));
}
`;

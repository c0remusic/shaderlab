import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Hatching — la taille-douce : des tailles parallèles dont la CHARGE suit le
 * ton, et qui se croisent dans les ombres.
 *
 * D'OÙ ÇA VIENT. Demandé par Antoine le 2026-08-01 ; `Hatching` figure au
 * catalogue Figma des shaders, et sa fiche n'a pas pu être lue (la page ne
 * publie que ses quatre vedettes). La conception s'appuie donc sur la référence
 * de GRAVURE, pas sur la surface de contrôle de Figma — écart assumé et écrit
 * ici plutôt que deviné en silence.
 *
 * CE QUE FAIT UN GRAVEUR, et que la version naïve ne fait pas. Le raccourci
 * évident est de comparer la luminance à un motif de rayures et de trancher :
 * on obtient un escalier crénelé dont la réponse tonale est en marches. Un
 * graveur, lui, ne change pas l'ESPACEMENT de ses tailles au sein d'une même
 * passe — il change leur CHARGE (la largeur du trait creusé), et quand la
 * charge sature, il repasse une seconde fois dans une autre direction. C'est
 * cette progression qui donne sa gamme continue à une estampe en noir et blanc
 * pur, et c'est elle qui est reproduite ici :
 *
 * 1. **La largeur du trait suit le ton, pas un seuil.** Chaque couche a une
 *    plage tonale propre : la première se charge des clairs vers les moyens, la
 *    deuxième prend le relais quand la première sature, et ainsi de suite. Un
 *    unique seuil binaire aurait donné deux valeurs — encré ou pas.
 * 2. **Les couches se CROISENT.** Chaque couche tourne de `crossAngle` par
 *    rapport à la précédente. C'est le passage de la taille simple à la taille
 *    croisée, et c'est ce qui permet d'atteindre le noir sans jamais élargir un
 *    trait jusqu'à l'aplat.
 * 3. **Le ton est lu sur l'axe PERCEPTUEL** (`linear_to_srgb(luma)`). Sur
 *    l'axe linéaire, les quatre cinquièmes de l'image tomberaient dans la
 *    première couche et les trois autres ne serviraient qu'aux ombres les plus
 *    fermées — la même panne, et le même correctif, que le seuil d'`outlines`
 *    et les bascules de `duotone`.
 * 4. **L'espacement est en PIXELS**, pas en UV. En UV, une trame à 45° sortirait
 *    à ~34° sur une photo 3:2 et l'espacement serait anisotrope. Même convention
 *    que `outlines` et `grain` : on travaille en espace pixel, l'angle demandé
 *    est l'angle obtenu.
 *
 * DEUX POINTS D'ÉCRITURE QUI NE SE DEVINENT PAS :
 *
 * - **La couverture d'un trait est une DIFFÉRENCE DE DEUX BORDS**, jamais un
 *   `smoothstep` sur la distance. Un `smoothstep` centré rend 0,5 pour une
 *   largeur NULLE — donc un voile gris sur toute l'image là où la trame ne doit
 *   rien tracer, et il faudrait le rattraper par une garde. La différence de
 *   deux couvertures de demi-plan s'annule exactement à largeur nulle, par
 *   construction : les deux termes deviennent égaux.
 * - **La dérivée écran est connue ANALYTIQUEMENT.** La phase vaut
 *   `p / espacement` et `p` est une distance en pixels : un pixel de
 *   déplacement perpendiculaire à la taille change la phase de `1/espacement`,
 *   exactement. `fwidth` n'apporterait rien — et l'interdirait, puisque les
 *   dérivées implicites exigent un flux de contrôle uniforme que la boucle sur
 *   les couches ne garantit pas.
 *
 * COÛT : aucun tap (le pixel courant suffit), une seule passe, une boucle bornée
 * à quatre couches.
 */

/** Nombre maximal de couches de taille. Quatre suffit à couvrir la gamme :
 *  au-delà, les directions se rapprochent au point que la cinquième couche
 *  tombe sur les traits de la première et n'ajoute que de la densité, pas de la
 *  matière. C'est aussi la borne où une estampe réelle s'arrête. */
const MAX_LAYERS = 4;

export const hatching: EffectModule = {
  id: "hatching",
  name: "Hatching",
  params: [
    { name: "angle", label: "Direction", unit: "degrees", min: 0, max: 360, default: 45, step: 1, hint: "Orientation de la première couche de tailles" },
    { name: "spacing", label: "Espacement", unit: "pixels", min: 2, max: 60, default: 9, step: 0.5, hint: "Distance entre deux tailles, en pixels — c'est la finesse de la trame" },
    { name: "weight", label: "Charge maximale", unit: "percent", min: 0.05, max: 1, default: 0.62, step: 0.01, hint: "Largeur du trait quand sa couche sature, en fraction de l'espacement. À 1 les traits se touchent et la couche devient un aplat — ce qu'un graveur évite justement en repassant dans une autre direction" },
    { name: "crossAngle", label: "Croisement", unit: "degrees", min: 0, max: 180, default: 65, step: 1, hint: "Rotation de chaque couche par rapport à la précédente. C'est le passage de la taille simple à la taille croisée" },
    { name: "layers", label: "Nombre de couches", unit: "none", min: 1, max: MAX_LAYERS, default: 3, step: 1, hint: "Combien de passages successifs. Chacun prend le relais quand le précédent sature — c'est ce qui donne une gamme continue avec une encre unique" },
    { name: "blackPoint", label: "Point noir", unit: "percent", min: 0, max: 0.95, default: 0.05, step: 0.01, hint: "Ton d'entrée à partir duquel toutes les couches sont saturées — le monter ferme les ombres" },
    { name: "whitePoint", label: "Point blanc", unit: "percent", min: 0.05, max: 1, default: 0.95, step: 0.01, hint: "Ton d'entrée à partir duquel plus aucune taille n'est tracée — le descendre encre les hautes lumières" },
    { name: "inkHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 30, step: 1, colorGroup: { key: "ink", role: "hue", label: "Encre" } },
    { name: "inkSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.15, step: 0.01, colorGroup: { key: "ink", role: "saturation", label: "Encre" } },
    { name: "inkLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.08, step: 0.01, colorGroup: { key: "ink", role: "lightness", label: "Encre" } },
    // Même paramètre, même nom et même raison que celui d'`outlines` : un voile
    // ADDITIF en linéaire, physiquement une lumière parasite, pas un fondu vers
    // du blanc en perceptuel (qui demanderait un gamma manuel, interdit ici).
    { name: "wash", label: "Délavé du fond", unit: "percent", min: 0, max: 1, default: 0.75, step: 0.01, hint: "Éclaircit la photo sous la trame — 0 = tailles sur la photo intacte, 1 = estampe sur papier blanc" },
  ],
  wgsl: `
${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}
const HATCH_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

// Couverture d'une taille, comme DIFFÉRENCE DE DEUX BORDS. \`h\` est la
// demi-largeur et \`aa\` la demi-largeur de la transition, toutes deux en unités
// de phase (1 = un espacement).
//
// L'écriture évidente — \`smoothstep(h + aa, h - aa, dist)\` — rend 0,5 au centre
// pour h = 0, donc un voile gris là où la trame ne doit RIEN tracer. Ici les
// deux termes deviennent égaux quand h s'annule, et la couverture avec eux :
// c'est exact par construction, pas rattrapé par une garde.
fn hatch_stripe(dist: f32, h: f32, aa: f32) -> f32 {
  let dedans = clamp((h + aa - dist) / (2.0 * aa), 0.0, 1.0);
  let dehors = clamp((aa - h - dist) / (2.0 * aa), 0.0, 1.0);
  return dedans - dehors;
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let angle = radians(params[0]);
  let spacing = max(params[1], 1.0);
  let weight = clamp(params[2], 0.0, 1.0);
  let crossAngle = radians(params[3]);
  let layers = clamp(i32(params[4] + 0.5), 1, ${MAX_LAYERS});
  let blackPoint = clamp(params[5], 0.0, 0.95);
  // Un point blanc sous le point noir inverserait la réponse en silence, avec
  // un dénominateur négatif. Borné juste au-dessus — l'inversion se fait en
  // échangeant les deux curseurs, là où elle se voit.
  let whitePoint = max(params[6], blackPoint + 0.001);
  let wash = clamp(params[10], 0.0, 1.0);

  // Espace PIXEL : l'angle demandé est l'angle obtenu, et l'espacement vaut la
  // même distance sur les deux axes. En UV, une trame à 45° sortirait à ~34°
  // sur une photo 3:2.
  let px = uv * vec2<f32>(textureDimensions(srcTexture));

  // \`color.rgb\` est LINÉAIRE (format de texture -srgb) ; la charge des tailles
  // se POSITIONNE sur l'axe perceptuel, sans qu'aucune valeur de couleur ne
  // soit convertie.
  let tone = linear_to_srgb(dot(color.rgb, HATCH_LUMA));
  let t = clamp((tone - blackPoint) / (whitePoint - blackPoint), 0.0, 1.0);

  // Dérivée écran ANALYTIQUE : un pixel perpendiculaire à la taille change la
  // phase de 1/espacement, exactement. La transition court donc sur un pixel de
  // part et d'autre du bord, quelle que soit la finesse de la trame.
  let aa = 1.0 / spacing;

  let steps = f32(layers);
  // Union des couches : \`1 - produit(1 - c)\`. Une SOMME ferait dépasser 1 aux
  // croisements et écrêterait le trait, une union les superpose comme deux
  // passages d'encre opaque — ce qui est exactement ce qu'est une taille
  // croisée.
  var clair = 1.0;
  for (var k = 0; k < layers; k = k + 1) {
    let fk = f32(k);
    // Plage tonale de la couche : la première va de 1 à (n-1)/n, la deuxième de
    // (n-1)/n à (n-2)/n, etc. Chacune prend le relais quand la précédente
    // sature, au lieu de se charger toutes ensemble.
    let hi = (steps - fk) / steps;
    let lo = (steps - fk - 1.0) / steps;
    let charge = clamp((hi - t) / (hi - lo), 0.0, 1.0) * weight;

    let a = angle + fk * crossAngle;
    let dir = vec2<f32>(cos(a), sin(a));
    // Distance à la taille la PLUS PROCHE, en unités de phase.
    let ph = dot(px, dir) / spacing;
    let dist = abs(ph - round(ph));
    clair = clair * (1.0 - hatch_stripe(dist, 0.5 * charge, aa));
  }
  let encre = 1.0 - clair;

  // L'encre sort du picker en sRGB (valeur PERCEPTUELLE, exactement ce
  // qu'affiche la pastille) : décodée vers le linéaire avant tout mélange,
  // comme outlines, duotone et glow.
  let ink = srgb_to_linear3(hsl2rgb(params[7] / 360.0, params[8], params[9]));
  let papier = mix(color.rgb, vec3<f32>(1.0), wash);
  return vec4<f32>(mix(papier, ink, encre), color.a);
}
`,
};

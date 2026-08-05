import type { DisplayCondition, EffectModule } from "./types";
import { INK_TEXTURE_WGSL, inkTextureParams } from "./inkTexture";
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

/** Formes de la ligne de taille. L'index EST la valeur du paramètre.
 *
 *  `Droites` est en tête, donc à l'index 0, donc le défaut : c'est ce que cet
 *  effet faisait avant ce paramètre, et l'ajout ne bouge aucun rendu existant.
 *
 *  Les trois autres viennent de la fiche Figma du shader `Hatching` (Waves,
 *  Zigzag, Circles), lue le 2026-08-01. Leur trame est DÉCORATIVE là où la
 *  nôtre est une taille-douce ; les deux lectures cohabitent ici sans se gêner,
 *  puisque le croisement par couches reste actif quelle que soit la forme. */
const PATTERNS = ["Droites", "Ondulations", "Zigzag", "Cercles"] as const;
const PATTERN_STRAIGHT = 0;
const PATTERN_WAVES = 1;
const PATTERN_ZIGZAG = 2;
const PATTERN_CIRCLES = 3;

/** Les deux formes qui SERPENTENT, nommées UNE fois.
 *
 *  Cette condition a deux porteurs — les deux réglages d'onde et la section qui
 *  les regroupe — et c'est délibéré : sur les paramètres, elle rend une
 *  propriété MESURÉE du shader (campagne du 2026-08-05, `waveAmplitude` et
 *  `waveFrequency` inertes en Droites comme en Cercles) ; sur la section, elle
 *  rend la décision d'AFFICHAGE de les lire ensemble. Réorganiser les sections
 *  un jour ne doit pas rouvrir deux curseurs prouvés inertes, et c'est pour ça
 *  que le paramètre garde la sienne.
 *
 *  Deux porteurs, mais une seule ÉCRITURE : deux listes d'index recopiées
 *  divergeraient en silence — une section affichée là où ses deux curseurs sont
 *  masqués ne rend qu'un titre vide, et aucun test de rendu ne peut le voir. */
const EN_ONDE = { param: "pattern", equals: [PATTERN_WAVES, PATTERN_ZIGZAG] } satisfies DisplayCondition;

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
    { name: "pattern", label: "Forme des tailles", unit: "none", min: 0, max: PATTERNS.length - 1, default: PATTERN_STRAIGHT, step: 1, choices: [...PATTERNS], hint: "Droites : la taille-douce classique. Ondulations et Zigzag font serpenter les tailles. Cercles les enroule autour d'un point, et l'orientation n'a alors plus d'objet." },
    // L'onde n'a de sens que pour les deux formes qui SERPENTENT — Ondulations
    // (1) et Zigzag (2). Les Droites n'ont rien à faire onduler, et les Cercles
    // ont leur propre géométrie. Les deux configurations excluantes ont été
    // rendues SÉPARÉMENT le 2026-08-05
    // (`docs/superpowers/plans/2026-08-05-applicabilite-task1-resultats.md`),
    // parce qu'elles n'empruntent pas la même branche de `hatch_coord` :
    // « inerte en Droites » ne dit rien de « inerte en Cercles ».
    // L'infobulle reste — le masquage dit QUE, elle seule dit POURQUOI.
    { name: "waveAmplitude", label: "Amplitude de l'onde", unit: "pixels", min: 0, max: 60, default: 12, step: 0.5, appliesWhen: EN_ONDE, hint: "De combien les tailles s'écartent de la ligne droite. Sans objet en Droites et en Cercles." },
    { name: "waveFrequency", label: "Fréquence de l'onde", unit: "none", min: 0.2, max: 40, default: 6, step: 0.2, appliesWhen: EN_ONDE, hint: "Nombre d'oscillations sur la plus petite dimension de la toile. Sans objet en Droites et en Cercles." },
    { name: "centerX", label: "Centre X", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Point autour duquel les tailles s'enroulent. Ne sert qu'en Cercles." },
    { name: "centerY", label: "Centre Y", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Voir Centre X." },
    // ── ENCRE RÉELLE (transversal, `inkTexture.ts`), ajoutée À LA FIN le
    // 2026-08-05 : l'index d'un paramètre est persisté dans les presets.
    ...inkTextureParams(),
  ],
  // Le scan arrive par le binding 7. Interdit les passes internes
  // (`validateEffect`) — sans conséquence, `hatching` est mono-passe.
  libraryTexture: { indexParam: "encreRang" },
  /**
   * CINQ SECTIONS, ET LA FORME DES TAILLES EN COMMANDE DEUX.
   *
   * Cet effet tient en deux temps : une GÉOMÉTRIE de trame (par où passent les
   * tailles, à quelle charge, combien de fois croisées) puis un ENCRAGE (avec
   * quoi on trace, sur quel papier, et sur quelle plage de tons). Entre les
   * deux, `pattern` choisit la forme de la ligne — et deux blocs de réglages ne
   * fabriquent leur géométrie que pour certaines de ces formes : l'onde ne fait
   * serpenter que les Ondulations et le Zigzag, le centre n'enroule que les
   * Cercles. Ce sont exactement ces deux blocs-là qui portent une condition ;
   * la trame, la tonalité et l'encre servent les quatre formes et n'en portent
   * aucune.
   *
   * ⚠️ `pattern` EST DANS « Trame », DONC DANS UNE SECTION SANS CONDITION. Un
   * sélecteur de mode rangé dans une section conditionnelle disparaîtrait avec
   * elle et ne se rouvrirait jamais — la panne exacte que `validateEffect`
   * refuse déjà quand un `appliesWhen` se vise lui-même.
   *
   * ⚠️ AUCUN INDEX N'A BOUGÉ : une section cite des NOMS et regroupe des items
   * de RENDU, `params[]` reste dans l'ordre où les presets le lisent. L'ordre
   * d'affichage DANS une section reste celui de `params[]`, donc l'ordre de
   * citation ci-dessous est documentaire — il est écrit dans l'ordre des index
   * pour que personne n'y lise une intention de tri. Conséquence visible et
   * assumée : `pattern` (index 11) s'affiche EN BAS de sa section, sous des
   * réglages qu'il commande, exactement comme `detectMode` dans `outlines`.
   *
   * ⚠️ LE GROUPE DE COULEUR RESTE ENTIER dans « Encre » : `ParamPanel` ancre la
   * pastille à l'index du premier de ses trois rôles, donc une section qui n'en
   * citerait que deux casserait le contrôle au lieu de le déplacer.
   *
   * `wash` est rangé dans « Encre » et non dans « Tonalité » : il ne touche pas
   * la réponse tonale des tailles, il éclaircit le PAPIER sous elles — ce qui
   * reste de la photo dans l'estampe relève de l'encrage, pas de la plage.
   */
  sections: [
    {
      // OÙ PASSENT LES TAILLES. Direction, finesse, charge, croisement, nombre
      // de passages, forme de la ligne : les six réglages qui décident du
      // tracé, avant toute question d'encre. Liste et non grille — le gabarit
      // en colonnes est fait pour des réglages COURTS, et ces six-là portent
      // des libellés longs dont une liste de choix.
      id: "trame",
      label: "Trame",
      layout: "liste",
      params: ["angle", "spacing", "weight", "crossAngle", "layers", "pattern"],
    },
    {
      // LES DEUX BORNES D'UNE MÊME PLAGE, donc une paire : au-dessus du point
      // blanc plus aucune taille n'est tracée, sous le point noir toutes les
      // couches saturent. Aucun des deux ne se règle sans regarder l'autre —
      // le shader refuse d'ailleurs de les laisser se croiser.
      id: "tonalite",
      label: "Tonalité",
      layout: "paire",
      params: ["blackPoint", "whitePoint"],
    },
    {
      // AVEC QUOI ON TRACE, ET SUR QUOI. La couleur du trait et le délavé du
      // fond sont les deux seuls réglages qui déposent de la matière ; les
      // séparer aurait fait deux sections d'une ligne.
      id: "encre",
      label: "Encre",
      layout: "liste",
      params: ["inkHue", "inkSaturation", "inkLightness", "wash"],
    },
    {
      // Amplitude et fréquence ne veulent rien dire l'une sans l'autre — c'est
      // la même onde, décrite par ses deux dimensions — d'où la paire plutôt
      // que deux lignes pleine largeur.
      id: "onde",
      label: "Onde",
      layout: "paire",
      appliesWhen: EN_ONDE,
      params: ["waveAmplitude", "waveFrequency"],
    },
    {
      // ⚠️ CETTE CONDITION-CI N'EST PAS MESURÉE, contrairement à celle de
      // l'onde. Elle repose sur la lecture complète du flux : `centerPx` n'a
      // qu'un lecteur, `hatch_coord`, qui ne s'en sert que dans sa branche
      // Cercles. C'est pourquoi elle est portée par la SECTION et par elle
      // seule — une décision d'affichage se relit ici, alors qu'un
      // `appliesWhen` posé sur les deux paramètres se lirait comme un verdict
      // de la campagne du 2026-08-05, qui ne les a jamais vus : leur infobulle
      // dit « Ne sert qu'en Cercles », phrase que le relevé des « Sans objet
      // en … » n'a pas ramassée.
      //
      // Les coordonnées d'un point vont par deux par nature. Pas de gabarit
      // `pose` malgré leur unité en percent : cet effet ne déclare aucun
      // `canvasControl`, et une section « posée » sans contrôle sur la toile
      // serait un titre au-dessus de rien (refusé par `validateEffect`).
      id: "centre",
      label: "Centre",
      layout: "paire",
      appliesWhen: { param: "pattern", equals: PATTERN_CIRCLES },
      params: ["centerX", "centerY"],
    },
  ],
  wgsl: `
${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${INK_TEXTURE_WGSL}
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

// Coordonnée de la taille, ET la norme de son gradient, selon la forme.
// Renvoie vec2(phase en pixels, |gradient|).
//
// LE GRADIENT N'EST PAS DÉCORATIF. L'antialiasing de cet effet repose sur le
// fait que la dérivée écran de la phase est connue : pour des droites elle vaut
// exactement 1, donc un pixel de déplacement change la phase d'un pixel. Dès
// que la ligne ONDULE, la phase varie plus vite là où l'onde est raide — et une
// largeur de transition calculée pour des droites y crénellerait la taille,
// précisément aux endroits les plus visibles. Chaque forme rend donc sa propre
// norme, analytiquement.
fn hatch_coord(px: vec2<f32>, dir: vec2<f32>, motif: i32, amp: f32, waveK: f32, center: vec2<f32>) -> vec2<f32> {
  if (motif == ${PATTERN_CIRCLES}) {
    // Cercles concentriques : la phase EST la distance au centre, dont le
    // gradient est unitaire partout (sauf au centre exact, où la garde évite
    // une division par zéro dans la normalisation implicite).
    return vec2<f32>(length(px - center), 1.0);
  }
  let perp = vec2<f32>(-dir.y, dir.x);
  let base = dot(px, dir);
  if (motif == 0) {
    return vec2<f32>(base, 1.0);
  }
  let u = dot(px, perp) * waveK;
  if (motif == 1) {
    // ONDULATIONS : sinusoïde. d(amp*sin(k*u))/du = amp*k*cos(k*u), et la
    // composante le long de dir reste 1 — d'où la norme euclidienne des deux.
    let d = amp * waveK * cos(u);
    return vec2<f32>(base + amp * sin(u), sqrt(1.0 + d * d));
  }
  // ZIGZAG : onde triangulaire de même période et même amplitude. Sa pente est
  // CONSTANTE en valeur absolue (4/TAU par unité de u), donc la norme ne dépend
  // pas de la position — contrairement à la sinusoïde.
  let t = fract(u / 6.283185307179586);
  let tri = abs(t * 4.0 - 2.0) - 1.0;
  let pente = amp * waveK * 4.0 / 6.283185307179586;
  return vec2<f32>(base + amp * tri, sqrt(1.0 + pente * pente));
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
  let motif = i32(params[11] + 0.5);
  let waveAmp = max(params[12], 0.0);
  let waveFreq = max(params[13], 0.01);
  let center = vec2<f32>(params[14], params[15]);
  // params[16] = rang du scan d'encre, lu par le CPU pour choisir la texture.
  let encreForce = clamp(params[17], 0.0, 1.0);
  let encreEchelle = max(params[18], 0.05);

  // Espace PIXEL : l'angle demandé est l'angle obtenu, et l'espacement vaut la
  // même distance sur les deux axes. En UV, une trame à 45° sortirait à ~34°
  // sur une photo 3:2.
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let px = uv * dims;
  // Fréquence exprimée en cycles sur la PLUS PETITE dimension : le réglage
  // garde le même sens sur une photo carrée et sur un panoramique, là où une
  // fréquence par axe changerait de densité avec le cadrage.
  // \`waveK\` et non \`k\` : la boucle sur les couches, plus bas, declare deja
  // un compteur nomme \`k\`, qui masquerait celui-ci. Le shader COMPILE quand
  // meme dans certains cas — ici il a rate sur un type, mais un i32 la ou on
  // attend un f32 est le genre de collision qui passe silencieusement quand
  // les types coincident. Attrape par npm run test:gpu-shaders, jamais par tsc.
  let waveK = 6.283185307179586 * waveFreq / min(dims.x, dims.y);
  let centerPx = center * dims;

  // \`color.rgb\` est LINÉAIRE (format de texture -srgb) ; la charge des tailles
  // se POSITIONNE sur l'axe perceptuel, sans qu'aucune valeur de couleur ne
  // soit convertie.
  let tone = linear_to_srgb(dot(color.rgb, HATCH_LUMA));
  let t = clamp((tone - blackPoint) / (whitePoint - blackPoint), 0.0, 1.0);

  // Dérivée écran ANALYTIQUE. Sur des droites, un pixel perpendiculaire à la
  // taille change la phase d'exactement un pixel ; sur une onde, il la change
  // d'autant plus que l'onde est raide. La norme du gradient est donc rendue
  // par \`hatch_coord\` et multiplie la largeur de transition — sans quoi une
  // trame ondulée crénellerait là où elle serpente le plus.

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
    // Coordonnée de la taille ET norme de son gradient, selon la forme.
    let c = hatch_coord(px, dir, motif, waveAmp, waveK, centerPx);
    // Distance à la taille la PLUS PROCHE, en unités de phase.
    let ph = c.x / spacing;
    let dist = abs(ph - round(ph));
    let aa = c.y / spacing;
    // BAVURE D'ENCRE : la DEMI-LARGEUR du trait varie localement, parce qu'un
    // burin ne creuse pas regulierement et qu'une encre ne s'etale pas
    // uniformement. On froisse la largeur et non la phase : la trame garde son
    // orientation et son espacement, c'est le TRAIT qui devient sale.
    // A force nulle, ink_froisse rend sa valeur inchangee.
    //
    // AUCUN BACKTICK NI ACCENT ICI : bloc dans un template literal JS.
    let demiLargeur = ink_froisse(0.5 * charge, uv, encreEchelle, encreForce);
    clair = clair * (1.0 - hatch_stripe(dist, demiLargeur, aa));
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

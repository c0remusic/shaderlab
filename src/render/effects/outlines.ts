import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { UV_SPACE_WGSL } from "./uvSpace";
import { INPUT_DRIVER_WGSL, inputSourceParam } from "./inputMode";
import { EDGE_GRADIENT_WGSL, EDGE_SPACING_WGSL, SCHARR_NORM } from "./edgeGradient";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Outlines — trace les contours de l'image à l'encre, du simple rehaut de
 * silhouette jusqu'au dessin au trait sur fond délavé.
 *
 * LA VERSION NAÏVE, et pourquoi elle rend « filtre Photoshop 2005 » : Sobel sur
 * la luminance, seuil binaire, trait noir. Quatre pannes, toutes visibles à
 * l'œil, toutes corrigées ici :
 *
 * 1. **Le seuil binaire crénelle.** Un contour est une isoligne : la trancher à
 *    un booléen produit un escalier de pixels. Ici le seuil est un
 *    `smoothstep`, et sa largeur ne descend JAMAIS sous `fwidth(mag)` — la
 *    dérivée écran de la magnitude. Le trait est donc antialiasé par
 *    construction, quelle que soit la position du curseur « Fondu ». C'est le
 *    même garde-fou analytique que l'overlay de masque (`effectPassRunner.ts`).
 *
 * 2. **Sobel n'est pas isotrope.** Ses poids (1,2,1) donnent une réponse qui
 *    dépend de l'ORIENTATION du contour : une diagonale sort ~10 % plus faible
 *    qu'une verticale, donc un même seuil ouvre les traits horizontaux et ferme
 *    les obliques — le dessin se troue par endroits sans raison lisible. Les
 *    poids de Scharr (3,10,3) sont l'optimum de symétrie de rotation pour un
 *    noyau 3x3 ; le trait garde le même poids dans toutes les directions.
 *
 * 3. **Le gradient d'une image LINÉAIRE mesure un niveau, pas un contraste.**
 *    C'est la panne la plus grave et la moins soupçonnée : en lumière linéaire,
 *    l'écart entre deux tons voisins est proportionnel au niveau local. Un même
 *    contraste perçu produit donc un gradient ~10x plus grand dans une haute
 *    lumière que dans une ombre — le filtre entoure les ciels et ignore
 *    entièrement les zones sombres, et le seuil devient un réglage
 *    d'EXPOSITION déguisé. Le gradient est donc mesuré sur le ton PERCEPTUEL
 *    (`linear_to_srgb(luma)`), ce qui normalise la réponse : c'est le même
 *    usage, déjà précédent dans ce dépôt, que la courbe de `grain` et les
 *    bascules de `duotone` — on POSITIONNE une réponse sur l'axe perceptuel,
 *    on ne modifie aucune valeur de couleur.
 *
 * 4. **Un gradient de luminance est aveugle aux contours isoluminants.** Une
 *    fleur rouge sur des feuilles vertes, un vêtement sur une peau : mêmes
 *    luminances, contour bien réel, et Sobel n'y voit rien. Le curseur
 *    « Sensibilité couleur » ajoute un second gradient, calculé sur la
 *    CHROMATICITÉ (les écarts de canaux normalisés par leur somme, donc
 *    indépendants de l'exposition). Sans tap supplémentaire : les mêmes neuf
 *    échantillons portent les deux mesures.
 *
 * ENTRÉE (2026-08-01, cahier de références §6bis). Figma expose trois modes
 * d'entrée sur son équivalent : Luma, Luma INVERSÉ, Alpha. Nous en exposons
 * DEUX, et le troisième est écarté sur preuve : cet effet mesure un GRADIENT,
 * or |∇(1−x)| = |∇x| — inverser la luminance laisse la magnitude rigoureusement
 * inchangée, donc le trait tracé serait identique au pixel près. « Luma
 * inversé » ici serait un contrôle inerte, l'échec silencieux que ce dépôt
 * proscrit (voir `INPUT_SOURCE_CHOICES`). L'entrée Alpha, elle, mord sur du
 * réel depuis que la toile porte une couverture (« le fond devient un calque »,
 * 2026-07-28) : elle trace la SILHOUETTE d'un élément de montage, ce que le
 * gradient de luminance ne sait pas voir quand l'élément et son fond ont des
 * tons voisins.
 *
 * COÛT : 8 taps (le tap central a des poids nuls dans les deux noyaux de
 * Scharr — l'échantillonner serait une lecture payée pour être multipliée par
 * zéro), une seule passe, aucune texture intermédiaire.
 */
export const outlines: EffectModule = {
  id: "outlines",
  name: "Outlines",
  params: [
    // Écartement des taps, EN PIXELS. Il fait deux choses à la fois, et c'est
    // voulu : il donne son épaisseur au trait ET il agit comme passe-bas (des
    // taps écartés ne voient plus le grain). Un noyau à écartement fixe aurait
    // exigé un second curseur « lissage » pour ne pas dessiner le bruit.
    { name: "thickness", label: "Épaisseur du trait", unit: "pixels", min: 0.5, max: 12, default: 2.5, step: 0.1, hint: "Écartement des taps — épaissit le trait et, du même geste, empêche le grain d'être dessiné" },
    { name: "threshold", label: "Seuil", unit: "percent", min: 0, max: 0.6, default: 0.09, step: 0.005, hint: "Contraste minimal (en tons perceptuels, sur l'épaisseur du trait) pour qu'un contour soit tracé" },
    { name: "softness", label: "Fondu du trait", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "0 = trait franc (toujours antialiasé), 1 = trait fondu qui s'éteint progressivement sur les contours faibles" },
    { name: "chroma", label: "Sensibilité couleur", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Fait aussi lever les contours entre deux couleurs de MÊME luminosité (rouge/vert), qu'un contour de luminance ne voit pas. Sans objet en entrée Alpha : une couverture n'a pas de chromaticité." },
    { name: "inkHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 210, step: 1, colorGroup: { key: "ink", role: "hue", label: "Encre" } },
    { name: "inkSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "ink", role: "saturation", label: "Encre" } },
    { name: "inkLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.06, step: 0.01, colorGroup: { key: "ink", role: "lightness", label: "Encre" } },
    // Voile de lumière ADDITIF en linéaire — physiquement une lumière parasite
    // (veiling glare), pas un fondu vers du blanc en perceptuel (qui
    // demanderait un gamma manuel, interdit ici). C'est pour ça qu'une petite
    // valeur agit déjà beaucoup : 0.20 en linéaire remonte un gris moyen de
    // ~0.48 à ~0.63 en perceptuel. Le curseur va jusqu'à 1 = papier blanc, donc
    // dessin au trait pur.
    { name: "wash", label: "Délavé du fond", unit: "percent", min: 0, max: 1, default: 0.2, step: 0.01, hint: "Éclaircit la photo sous le trait — 0 = contours sur la photo intacte, 1 = dessin au trait sur blanc" },
    inputSourceParam(),
  ],
  wgsl: `
${UV_SPACE_WGSL}${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${INPUT_DRIVER_WGSL}${EDGE_GRADIENT_WGSL}${EDGE_SPACING_WGSL}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let threshold = params[1];
  let softness = clamp(params[2], 0.0, 1.0);
  let chroma = clamp(params[3], 0.0, 1.0);
  let wash = clamp(params[7], 0.0, 1.0);
  let source = params[8];

  // Écartement des taps et noyau de Scharr : voir effects/edgeGradient.ts,
  // partagé avec coloredEdges. Deux copies auraient dérivé, et deux effets de
  // contour posés sur la même photo auraient dessiné des bords à des endroits
  // DIFFÉRENTS — ce qui ressemble à un choix esthétique et n'est qu'un
  // copier-coller qui a vieilli.
  let g = edge_scharr(uv, edge_spacing(params[0]), source);
  let gx = g.gx;
  let gy = g.gy;

  // /32 : réponse du noyau à une rampe unité sur un écartement de tap. \`mag\`
  // se lit donc directement comme « écart de ton perceptuel sur l'épaisseur du
  // trait », et le seuil garde le même sens quand on change l'épaisseur.
  let toneMag = sqrt(gx.x * gx.x + gy.x * gy.x) / ${SCHARR_NORM}.0;
  let chromaMag = sqrt(gx.y * gx.y + gy.y * gy.y + gx.z * gx.z + gy.z * gy.z) / ${SCHARR_NORM}.0;
  // max, pas somme : un contour de luminance NET ne doit pas être renforcé
  // parce qu'il est accessoirement coloré (le trait s'épaissirait sur les
  // contours colorés et nulle part ailleurs). Les deux mesures sont deux
  // DÉTECTEURS du même contour, pas deux contributions à additionner.
  // Le facteur 3 ramène l'échelle de la chromaticité sur celle du ton, pour que
  // le curseur soit lisible sur toute sa course plutôt que sur son dernier
  // dixième.
  let mag = max(toneMag, chroma * 3.0 * chromaMag);

  // Plancher fwidth : la largeur de la bascule ne descend jamais sous la
  // variation de \`mag\` d'un pixel écran à l'autre. C'est ce qui interdit
  // structurellement le trait crénelé, même à \`softness\` = 0.
  let band = max(max(softness * 0.5, fwidth(mag)), 0.0005);
  let line = smoothstep(threshold, threshold + band, mag);

  // L'encre sort du picker en sRGB (valeur PERCEPTUELLE, exactement ce
  // qu'affiche la pastille) : décodée vers le linéaire avant tout mélange,
  // comme duotone et glow.
  let ink = srgb_to_linear3(hsl2rgb(params[4] / 360.0, params[5], params[6]));
  let paper = mix(color.rgb, vec3<f32>(1.0), wash);
  return vec4<f32>(mix(paper, ink, line), color.a);
}
`,
};

import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { UV_SPACE_WGSL } from "./uvSpace";
// `srgb_to_linear3` appelle le scalaire `srgb_to_linear` — les deux helpers se
// prennent ensemble, comme dans `isolines`. Le gate `test:wgsl` l'a attrapé,
// `tsc` non : une chaîne WGSL incomplète compile côté TypeScript.
import { SRGB_TO_LINEAR_VEC3_WGSL, SRGB_TO_LINEAR_WGSL } from "./srgbTransfer";

/**
 * Aplat — une COULEUR UNIE, bornée par un masque ou par une primitive posée.
 *
 * VINGT-QUATRIÈME effet du registre, entré le 2026-08-17. Né prototype (ticket 23
 * de `.scratch/prochain-palier/`, écrit pour rendre le ticket 03 décidable) et
 * GARDÉ sur arbitrage d'Antoine le même jour : « faut l'améliorer type
 * photoshop ». Ce qu'il lui manque pour ça est ticketé, pas oublié — dégradé de
 * remplissage, poignées sur la toile, primitives supplémentaires.
 *
 * ⚠️ Il n'a PAS résolu la question qui l'a fait naître, et c'est le plus utile
 * qu'il ait fait : mis devant lui, Antoine a corrigé la question elle-même —
 * « c'était pour les masques et la sélection, pas pour un effet ». Une forme
 * SÉLECTIONNE. Cet effet reste parce qu'une couleur unie manquait au registre
 * (le cahier de postproduction la cite §96), pas parce qu'il répond aux formes.
 *
 * ─── D'OÙ IL VIENT, ET POURQUOI IL RESTE ───────────────────────────────────
 *
 * Le cahier de postproduction ne demande pas « des formes » en bloc. Il en
 * demande DEUX choses, et elles ne se ressemblent pas :
 *
 *  - §453, espace négatif : « création d'un aplat coloré à côté de la
 *    photographie », posé sur une grille ;
 *  - §393, ombres graphiques : « formes vectorielles noires », mode Multiply,
 *    « masque suivant les volumes du corps ou de l'objet ».
 *
 * Traduites en vocabulaire shaderlab, les deux disent la même chose : UNE
 * COULEUR UNIE, BORNÉE PAR QUELQUE CHOSE. Ce qui les sépare n'est pas la
 * couleur, c'est la borne — une primitive géométrique pour l'un, un masque qui
 * suit le sujet pour l'autre.
 *
 * Or shaderlab a déjà quatre façons de borner (pinceau, dégradé, luminosité,
 * range couleur) et douze modes de fusion. Ce qui manque au registre, mesuré le
 * 2026-08-17 sur ses vingt-trois entrées, c'est la couleur unie elle-même — le
 * cahier la cite pourtant §96, « calques Couleur unie en modes Color, Soft
 * Light ou Screen ».
 *
 * Il ne touche pas `LayerState`, ne porte aucun `contentSource`, et tient en dix
 * paramètres sur les 48 disponibles.
 *
 * ─── CE QU'IL NE FERA JAMAIS, ET OÙ ÇA VIT ─────────────────────────────────
 *
 * Une forme LIBRE — N points, Bézier, transformation perspective — ne s'écrira
 * pas ici, et pas par manque d'envie : `LayerState.params` est un
 * `Record<string, number>` servi par un uniform `array<f32, 48>`. Une forme à
 * douze points en consomme vingt-quatre pour ses seules coordonnées, et rien ne
 * dit combien de points l'utilisateur voudra.
 *
 * C'est le mur que le ticket 03 a fini par désigner, et sa conclusion n'était
 * pas « alors ouvrons la voie A » mais « alors ce n'est pas un effet » : ce que
 * ce mur borne est un OUTIL DE SÉLECTION, qui vit du côté de `mask/sources/` et
 * qui a sa propre carte à charter. Ne pas tenter de le faire entrer ici.
 *
 * ─── TROIS CHOIX QUI ÉVITENT LE RENDU CHEAP ────────────────────────────────
 *
 * 1. **Le bord est adouci EN PIXELS**, pas en fraction d'UV. Un adoucissement en
 *    UV donnerait un bord deux fois plus dur en hauteur qu'en largeur sur une
 *    photo 3:2, et changerait d'épaisseur avec la taille de la forme — c'est la
 *    même correction que l'épaisseur de trait d'`isolines`.
 * 2. **La couverture d'un rectangle est la MÊME fonction que celle d'une
 *    ellipse**, prise sur une distance différente. Deux blocs séparés auraient
 *    dérivé sur l'anticrénelage, qui est la seule partie difficile.
 * 3. **L'aplat peut COUVRIR là où il n'y a rien.** Son alpha de sortie est
 *    `max` de l'entrée et de la couverture, jamais l'alpha de l'entrée : le cas
 *    §453 pose précisément une couleur À CÔTÉ de la photo, donc sur une toile
 *    transparente. Un effet qui préserverait l'alpha d'entrée rendrait ce cas
 *    invisible tout en ayant l'air de marcher partout ailleurs.
 */
export const aplat: EffectModule = {
  id: "aplat",
  name: "Aplat",
  params: [
    {
      name: "borne",
      label: "Bornée par",
      unit: "none",
      min: 0,
      max: 2,
      default: 0,
      step: 1,
      // ⚠️ « Le masque » est le DÉFAUT, et ce n'est pas un hasard de rangement :
      // c'est l'hypothèse que ce prototype teste. Si elle suffit, les deux
      // primitives ci-dessous sont du confort, pas une capacité.
      choices: ["Le masque du calque", "Un rectangle", "Une ellipse"],
      hint: "Ce qui décide où la couleur se pose. « Le masque du calque » n'ajoute aucune géométrie — c'est le pinceau, le dégradé, la luminosité ou le range couleur qui borne, et les modes de fusion font le reste",
    },
    { name: "centreX", label: "Centre X", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.001, appliesWhen: { param: "borne", equals: [1, 2] }, hint: "Se manipule sur l'image" },
    { name: "centreY", label: "Centre Y", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.001, appliesWhen: { param: "borne", equals: [1, 2] } },
    { name: "largeur", label: "Largeur", unit: "percent", min: 0.01, max: 2, default: 0.4, step: 0.005, appliesWhen: { param: "borne", equals: [1, 2] }, hint: "En fraction de la LARGEUR du cadre. Au-delà de 1 la forme déborde, ce qui est le cas normal d'un aplat de bord" },
    { name: "hauteur", label: "Hauteur", unit: "percent", min: 0.01, max: 2, default: 0.4, step: 0.005, appliesWhen: { param: "borne", equals: [1, 2] } },
    { name: "rotation", label: "Rotation", unit: "degrees", min: -180, max: 180, default: 0, step: 1, appliesWhen: { param: "borne", equals: [1, 2] } },
    {
      name: "adoucissement",
      label: "Adoucissement du bord",
      unit: "pixels",
      min: 0,
      max: 400,
      default: 0,
      step: 1,
      appliesWhen: { param: "borne", equals: [1, 2] },
      // Le cahier §398 dit « léger ou aucun flou » pour une ombre graphique :
      // le défaut est donc ZÉRO, et non un adoucissement « qui fait joli ».
      hint: "Largeur du dégradé de bord, en pixels — donc constante quelle que soit la taille de la forme. Le cahier dit « léger ou aucun flou » pour une ombre graphique, d'où le défaut à 0",
    },
    { name: "teinte", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 0, step: 1, colorGroup: { key: "encre", role: "hue", label: "Couleur" } },
    { name: "saturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "encre", role: "saturation", label: "Couleur" } },
    { name: "clarte", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "encre", role: "lightness", label: "Couleur" } },
  ],
  // Le centre se pose sur la toile plutôt qu'à deux curseurs — c'est
  // exactement le geste que le chantier des contrôles existe pour rendre
  // possible, et une position en pourcentage réglée au curseur est le cas
  // d'école qu'ADR-0017 nomme.
  canvasControls: [
    { id: "centre", kind: "point", x: "centreX", y: "centreY", label: "Centre de la forme", visibleWhen: { param: "borne", equals: [1, 2] } },
  ],
  sections: [
    // La borne d'abord : c'est elle qui décide si les cinq réglages suivants
    // existent. Les mettre après aurait fait lire les curseurs avant la question
    // qui les commande.
    { id: "borne", label: "Étendue", layout: "liste", params: ["borne"] },
    {
      id: "forme",
      label: "Forme",
      layout: "grille",
      params: ["centreX", "centreY", "largeur", "hauteur", "rotation", "adoucissement"],
      appliesWhen: { param: "borne", equals: [1, 2] },
    },
    { id: "couleur", label: "Couleur", layout: "liste", params: ["teinte", "saturation", "clarte"] },
  ],
  wgsl: `
${UV_SPACE_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${HSL_TO_RGB_WGSL}

/** Couverture d'une forme depuis une DISTANCE SIGNEE, en pixels : negative
 *  dedans, positive dehors. Une seule fonction pour le rectangle et pour
 *  l'ellipse — ce qui change est la distance qu'on lui passe, jamais
 *  l'anticrenelage, qui est la seule partie ou deux copies auraient derive.
 *
 *  A adoucissement nul on retombe sur un bord d'un pixel, pas sur un bord dur :
 *  un bord dur sur une photo de 26 Mpx presentee reduite produit un escalier
 *  visible, et c'est exactement le rendu que la barre de qualite du depot
 *  refuse. */
fn aplat_couverture(distancePx: f32, adoucissementPx: f32) -> f32 {
  let demi = max(adoucissementPx, 1.0) * 0.5;
  return clamp(0.5 - distancePx / (2.0 * demi), 0.0, 1.0);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let borne = i32(params[0] + 0.5);

  let encre = srgb_to_linear3(hsl2rgb(params[7] / 360.0, params[8], params[9]));

  // BORNEE PAR LE MASQUE : aucune geometrie, couverture pleine. Le compositing
  // en aval multiplie deja par l'opacite et par le masque du calque, donc c'est
  // le pinceau (ou le degrade, la luminosite, le range couleur) qui decide ou
  // la couleur se pose. C'est l'hypothese que ce prototype teste.
  var couverture = 1.0;

  if (borne != 0) {
    let dims = vec2<f32>(textureDimensions(srcTexture));
    let centre = vec2<f32>(params[1], params[2]);
    // Demi-dimensions en UV. La largeur est exprimee en fraction de la LARGEUR
    // du cadre et la hauteur en fraction de sa HAUTEUR : un carre a l'ecran
    // demande donc deux valeurs differentes, ce qui est le comportement d'un
    // outil de mise en page et non celui d'une primitive isotrope.
    let demi = max(vec2<f32>(params[3], params[4]), vec2<f32>(0.0005)) * 0.5;

    // Rotation autour du CENTRE de la forme, et en espace ISOTROPE : tourner en
    // UV brut cisaillerait le rectangle sur une photo 3:2 au lieu de le tourner.
    let ar = aspectScale(dims);
    let d = (uv - centre) * ar;
    let a = params[5] * 0.017453292;
    let s = sin(a);
    let c = cos(a);
    let local = vec2<f32>(d.x * c + d.y * s, -d.x * s + d.y * c) / ar;

    // Un pixel vaut cette fraction d'UV sur chaque axe : c'est ce qui ramene la
    // distance en PIXELS, donc ce qui rend l'adoucissement independant de la
    // taille de la forme et du format de la photo.
    let pxParUv = dims;

    var distancePx = 0.0;
    if (borne == 1) {
      // RECTANGLE : distance signee d'un rectangle centre. Le \`max\` des deux
      // axes rend la distance de Tchebychev, dont l'iso-zero est le rectangle
      // lui-meme ; on la ramene en pixels par l'axe qui domine.
      let q = (abs(local) - demi) * pxParUv;
      distancePx = max(q.x, q.y);
    } else {
      // ELLIPSE : approximation de la distance signee par le gradient de la
      // forme implicite. \`length(k)\` seul rendrait une distance en unites
      // d'ellipse, dont le bord serait deux fois plus doux sur le grand axe que
      // sur le petit — le defaut exact que le point 1 de l'en-tete refuse.
      let k = local / demi;
      let g = length(k / (demi * pxParUv));
      distancePx = (length(k) - 1.0) / max(g, 0.0001);
    }
    couverture = aplat_couverture(distancePx, params[6]);
  }

  let melange = mix(color.rgb, encre, couverture);
  // ALPHA : \`max\` et non \`color.a\`. Un aplat doit pouvoir COUVRIR la ou il n'y
  // a rien — le cas §453 du cahier pose une couleur A COTE de la photo, donc
  // sur une toile transparente. Preserver l'alpha d'entree rendrait ce cas
  // invisible tout en ayant l'air correct partout ailleurs.
  return vec4<f32>(melange, max(color.a, couverture));
}
`,
};

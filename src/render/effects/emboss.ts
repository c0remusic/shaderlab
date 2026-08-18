import type { EffectModule } from "./types";
import { UV_SPACE_WGSL } from "./uvSpace";
import { INPUT_DRIVER_WGSL } from "./inputMode";
import { EDGE_GRADIENT_WGSL, EDGE_SPACING_WGSL, SCHARR_NORM } from "./edgeGradient";
import {
  LINEAR_TO_SRGB_WGSL,
  LINEAR_TO_SRGB_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
} from "./srgbTransfer";

/**
 * Relief (emboss) — l'image éclairée en lumière rasante.
 *
 * CE QUE C'EST, ET CE QUE ÇA N'EST PAS. Un relief lit la PENTE du ton et
 * l'éclaire depuis une direction : une pente tournée vers la lampe s'éclaircit,
 * la pente opposée s'assombrit, une zone plate reste au gris neutre. Ce n'est
 * pas un détecteur de contour — `outlines` prend la MAGNITUDE du gradient et
 * jette sa direction ; ici la direction est tout le sujet, et la magnitude n'est
 * que l'amplitude du modelé.
 *
 * D'où le partage sans conflit : les deux lisent le même `edge_scharr`, et ce
 * qui les sépare tient dans le produit scalaire de la ligne « relief ». C'est le
 * troisième lecteur du module `edgeGradient.ts`, dont l'en-tête annonçait « le
 * prochain effet à bords » — il est là.
 *
 * POURQUOI SCHARR PLUTÔT QU'UN NOYAU D'EMBOSS CLASSIQUE. Le noyau habituel
 * (`-1 0 / 0 1` sur la diagonale) n'éclaire QUE la diagonale qu'il code : pour
 * tourner la lampe, il faut réécrire le noyau, donc n'offrir que quatre ou huit
 * directions. En passant par un gradient isotrope, l'angle devient CONTINU et
 * l'amplitude ne dépend pas de l'orientation du bord — ce qui est exactement la
 * raison pour laquelle ce dépôt utilise Scharr et non Sobel.
 *
 * ── L'ESPACE, ET C'EST LE POINT QU'ON POURRAIT RATER ────────────────────────
 *
 * Le relief se calcule et s'applique en PERCEPTUEL, pas en lumière linéaire.
 * Ce n'est pas une entorse à la règle du dépôt, c'est sa lettre : le pilote de
 * `edgeTap` est déjà `linear_to_srgb(luma)` — les deux effets de contour le
 * faisaient chacun de leur côté avant que `inputMode.ts` ne rassemble la formule,
 * et pour la raison écrite là-bas (un gradient posé sur la luminance LINÉAIRE
 * est un réglage d'exposition déguisé). La pente est donc une grandeur
 * perceptuelle ; l'ajouter à une valeur linéaire additionnerait deux choses qui
 * ne se mesurent pas dans la même unité, et le même relief creuserait dix fois
 * plus dans les ombres que dans les clairs.
 *
 * ── LES DEUX RENDUS ─────────────────────────────────────────────────────────
 *
 *   Gris          — le relief SEUL, sur un gris neutre. C'est l'emboss de
 *                   Photoshop : l'image disparaît, il ne reste que son modelé.
 *   Sur l'image   — le relief AJOUTÉ à l'image, qui garde ses couleurs. C'est
 *                   ce qu'on obtient d'habitude en empilant un emboss en
 *                   Lumière tamisée ; ici c'est un choix, pas un montage.
 *
 * Aucun paramètre ne devient inerte d'un rendu à l'autre : les quatre autres
 * agissent dans les deux. Cet effet n'a donc AUCUNE condition d'applicabilité,
 * et c'est le cas nommé au point 2 du ticket 15 — un effet sans état caché n'a
 * rien à masquer, l'absence de condition n'y est pas une dette.
 *
 * ── POURQUOI « LUMINANCE INVERSÉE » N'EST PAS DANS LA LISTE D'ENTRÉE ────────
 *
 * `inputSourceParam()` en propose trois ; celui-ci n'en expose que deux, et
 * c'est mesurable sur la formule : inverser le pilote change le SIGNE du
 * gradient, donc retourne le relief — ce que `angle + 180°` fait déjà,
 * exactement. Deux surfaces pour un seul geste, c'est ce qu'ADR-0001 refuse.
 * L'entrée ALPHA, elle, est une vraie capacité distincte : elle donne le relief
 * de la SILHOUETTE d'un élément de montage, que la luminance ne peut pas voir.
 *
 * Les index 0 et 1 de cette liste locale valent donc exactement ceux de
 * `INPUT_SOURCE_CHOICES` (Luminance, Alpha) : le numéro part tel quel dans
 * `input_source`, sans traduction.
 */
export const emboss: EffectModule = {
  id: "emboss",
  name: "Relief",
  params: [
    {
      name: "rendu",
      label: "Rendu",
      unit: "none",
      min: 0,
      max: 1,
      default: 0,
      step: 1,
      choices: ["Gris", "Sur l'image"],
      hint: "Gris = le modelé seul, l'image disparaît. Sur l'image = le modelé ajouté à la photo, qui garde ses couleurs",
    },
    // 135° : la lampe en haut à gauche. C'est la convention de tous les reliefs
    // d'interface, et elle n'est pas arbitraire — l'œil lit un creux comme une
    // bosse quand l'éclairage vient d'en bas.
    { name: "angle", label: "Direction de la lumière", unit: "degrees", min: 0, max: 360, default: 135, step: 1 },
    { name: "force", label: "Force", unit: "none", min: 0, max: 4, default: 1.2, step: 0.05, hint: "Amplitude du modelé. Au-delà de ~2 sur une photo contrastée, les pentes fortes butent sur le noir et le blanc" },
    // ÉPAISSEUR = écartement des taps, donc l'ÉCHELLE du relief : à 1 px il suit
    // le grain, à 8 px il ne voit plus que les grandes formes. Même paramètre
    // que le `thickness` d'`outlines`, même helper, mêmes bornes de sécurité
    // (`edge_spacing` plancher à 0,25 px).
    { name: "epaisseur", label: "Échelle", unit: "pixels", min: 0.5, max: 8, default: 1, step: 0.1, hint: "Distance entre les taps du noyau. Petite = le relief suit le détail, grande = il ne garde que le modelé large" },
    {
      name: "entree",
      label: "Entrée",
      unit: "none",
      min: 0,
      max: 1,
      default: 0,
      step: 1,
      choices: ["Luminance", "Alpha"],
      hint: "Sur quoi la pente est mesurée — le ton de l'image, ou la couverture alpha (la silhouette d'un élément de montage)",
    },
  ],
  sections: [
    { id: "lumiere", label: "Lumière", layout: "liste", params: ["angle", "force", "epaisseur"] },
    { id: "rendu", label: "Rendu", layout: "liste", params: ["rendu", "entree"] },
  ],
  wgsl: `
${UV_SPACE_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${LINEAR_TO_SRGB_WGSL}${LINEAR_TO_SRGB_VEC3_WGSL}${INPUT_DRIVER_WGSL}${EDGE_GRADIENT_WGSL}${EDGE_SPACING_WGSL}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let g = edge_scharr(uv, edge_spacing(params[3]), params[4]);

  // SEULE LA COMPOSANTE x SERT : c'est le ton perceptuel. Les deux autres
  // portent la chromaticite, dont \`outlines\` a besoin pour lever les contours
  // isoluminants et dont un relief n'a que faire — une pente est une pente de
  // TON, et deux couleurs de meme clarte ne font aucun creux.
  //
  // Normalise par SCHARR_NORM (32, somme des poids d'un demi-noyau) : sans ca,
  // la course du curseur de force dependrait des poids du noyau.
  let pente = vec2<f32>(g.gx.x, g.gy.x) / ${SCHARR_NORM.toFixed(1)};

  // ECLAIRAGE RASANT. L'image est lue comme un CHAMP DE HAUTEUR — clair = haut —
  // dont la normale vaut \`normalize(-dh/dx, -dh/dy, 1)\`. L'eclairement rasant est
  // le produit scalaire de sa partie horizontale avec la direction de la lampe,
  // d'ou le signe MOINS devant la pente. Positif quand la face regarde la lampe,
  // negatif a l'oppose, nul sur le plat — le gris neutre des zones planes n'est
  // donc pas un choix, c'est une consequence.
  //
  // ⚠️ CE SIGNE A ETE PRIS A L'ENVERS A LA PREMIERE ECRITURE, et rien ne l'a dit :
  // le shader compilait, les references etaient fortes, la gate de signal verte.
  // C'est en OUVRANT la reference qu'on a vu le disque creme s'assombrir du cote
  // de la lampe au lieu de s'y eclairer — un plateau vu en cuvette. Un relief
  // inverse ressemble a un relief.
  //
  // -sin pour l'axe vertical : les UV descendent quand y augmente, donc un angle
  // de 135 degres designe bien le haut-gauche a l'ecran.
  let a = radians(params[1]);
  let lampe = vec2<f32>(cos(a), -sin(a));
  let relief = dot(-pente, lampe) * params[2];

  // TOUT SE PASSE EN PERCEPTUEL — voir l'en-tete. La sortie repasse en lineaire
  // parce que c'est ce que le pipeline transporte.
  var sortie = vec3<f32>(0.0);
  if (params[0] < 0.5) {
    // GRIS : 0,5 perceptuel, pas 0,5 lineaire. Le gris moyen d'un emboss est
    // celui que l'oeil lit a mi-course, et 0,5 lineaire ressort a ~0,74
    // perceptuel — un gris nettement clair, qui ecraserait toute la moitie
    // haute du relief contre le blanc.
    sortie = vec3<f32>(clamp(0.5 + relief, 0.0, 1.0));
  } else {
    sortie = clamp(linear_to_srgb3(color.rgb) + vec3<f32>(relief), vec3<f32>(0.0), vec3<f32>(1.0));
  }
  return vec4<f32>(srgb_to_linear3(sortie), color.a);
}
`,
};

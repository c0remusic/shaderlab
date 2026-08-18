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
      max: 3,
      default: 0,
      step: 1,
      // ⚠️ « Le masque » est le DÉFAUT, et ce n'est pas un hasard de rangement :
      // c'est l'hypothèse que ce prototype teste. Si elle suffit, les deux
      // primitives ci-dessous sont du confort, pas une capacité.
      // ⚠️ « Un polygone » est AJOUTÉ À LA FIN (2026-08-17, ticket 24 front 3).
      // L'index d'un choix est persisté dans les presets et cité en dur par les
      // `appliesWhen` ci-dessous : en insérer un au milieu décalerait les deux
      // primitives existantes et les trois références de pixels qui les citent.
      choices: ["Le masque du calque", "Un rectangle", "Une ellipse", "Un polygone"],
      hint: "Ce qui décide où la couleur se pose. « Le masque du calque » n'ajoute aucune géométrie — c'est le pinceau, le dégradé, la luminosité ou le range couleur qui borne, et les modes de fusion font le reste",
    },
    { name: "centreX", label: "Centre X", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.001, appliesWhen: { param: "borne", equals: [1, 2, 3] }, hint: "Se manipule sur l'image" },
    { name: "centreY", label: "Centre Y", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.001, appliesWhen: { param: "borne", equals: [1, 2, 3] } },
    { name: "largeur", label: "Largeur", unit: "percent", min: 0.01, max: 2, default: 0.4, step: 0.005, appliesWhen: { param: "borne", equals: [1, 2, 3] }, hint: "En fraction de la LARGEUR du cadre. Au-delà de 1 la forme déborde, ce qui est le cas normal d'un aplat de bord" },
    { name: "hauteur", label: "Hauteur", unit: "percent", min: 0.01, max: 2, default: 0.4, step: 0.005, appliesWhen: { param: "borne", equals: [1, 2, 3] } },
    { name: "rotation", label: "Rotation", unit: "degrees", min: -180, max: 180, default: 0, step: 1, appliesWhen: { param: "borne", equals: [1, 2, 3] } },
    {
      name: "adoucissement",
      label: "Adoucissement du bord",
      unit: "pixels",
      min: 0,
      max: 400,
      default: 0,
      step: 1,
      appliesWhen: { param: "borne", equals: [1, 2, 3] },
      // Le cahier §398 dit « léger ou aucun flou » pour une ombre graphique :
      // le défaut est donc ZÉRO, et non un adoucissement « qui fait joli ».
      hint: "Largeur du dégradé de bord, en pixels — donc constante quelle que soit la taille de la forme. Le cahier dit « léger ou aucun flou » pour une ombre graphique, d'où le défaut à 0",
    },
    { name: "teinte", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 0, step: 1, colorGroup: { key: "encre", role: "hue", label: "Couleur" } },
    { name: "saturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "encre", role: "saturation", label: "Couleur" } },
    { name: "clarte", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "encre", role: "lightness", label: "Couleur" } },

    // ─── AJOUTS DU 2026-08-17, ticket 24 ──────────────────────────────────
    // TOUS À LA FIN, sans exception : les index 0 à 9 sont gelés par trois
    // références de pixels et par les presets. Un ajout au milieu les décalerait
    // toutes en silence — le shader lirait `params[10]` là où le preset a écrit
    // autre chose, et aucun test ne le dirait.

    // FRONT 3 — le polygone. Un seul paramètre suffit : le nombre de côtés. Une
    // ÉTOILE n'est PAS ici, et c'est délibéré — elle demande deux rayons
    // alternés, donc une seconde géométrie, et le cahier de postproduction n'en
    // demande nulle part. L'ajouter « parce que Photoshop l'a » serait le
    // contraire de la règle du dépôt (« le doublon se mesure avant de s'écrire »,
    // et ici il n'y a même pas de besoin mesuré).
    {
      name: "cotes",
      label: "Côtés",
      unit: "none",
      min: 3,
      max: 12,
      default: 6,
      step: 1,
      appliesWhen: { param: "borne", equals: 3 },
      hint: "Nombre de côtés du polygone régulier. À 3 un triangle, à 12 un quasi-cercle — au-delà, l'ellipse fait mieux et moins cher",
    },

    // FRONT 1 — le remplissage en dégradé.
    //
    // ⚠️ « Couleur unie » est l'index 0 et le DÉFAUT : tout preset écrit avant
    // aujourd'hui lit 0 sur un paramètre absent de son document, donc rend
    // exactement ce qu'il rendait. C'est la condition pour que cet ajout ne
    // casse aucun preset, et elle vaut d'être dite plutôt que constatée.
    {
      name: "remplissage",
      label: "Remplissage",
      unit: "none",
      min: 0,
      max: 2,
      default: 0,
      step: 1,
      choices: ["Couleur unie", "Dégradé linéaire", "Dégradé radial"],
      hint: "Photoshop a trois calques de remplissage — Couleur unie, Dégradé, Motif. Les deux premiers sont ici ; le motif existe déjà ailleurs, c'est l'effet Texture",
    },
    { name: "teinte2", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 210, step: 1, appliesWhen: { param: "remplissage", equals: [1, 2] }, colorGroup: { key: "encre2", role: "hue", label: "Seconde couleur" } },
    { name: "saturation2", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.4, step: 0.01, appliesWhen: { param: "remplissage", equals: [1, 2] }, colorGroup: { key: "encre2", role: "saturation", label: "Seconde couleur" } },
    { name: "clarte2", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.75, step: 0.01, appliesWhen: { param: "remplissage", equals: [1, 2] }, colorGroup: { key: "encre2", role: "lightness", label: "Seconde couleur" } },
    {
      name: "angleDegrade",
      label: "Angle du dégradé",
      unit: "degrees",
      min: -180,
      max: 180,
      default: 90,
      step: 1,
      // Le radial n'a pas d'angle — il part du centre dans toutes les directions.
      appliesWhen: { param: "remplissage", equals: 1 },
      hint: "Direction du dégradé linéaire. Indépendant de la rotation de la forme : on veut souvent une forme droite et un dégradé oblique",
    },
    {
      name: "etendueDegrade",
      label: "Étendue du dégradé",
      unit: "percent",
      min: 0.02,
      max: 2,
      default: 0.6,
      step: 0.01,
      appliesWhen: { param: "remplissage", equals: [1, 2] },
      hint: "Distance sur laquelle la première couleur devient la seconde, en fraction du cadre. Courte = transition franche, longue = fondu large",
    },
    // L'INVERSE (ticket 12, tranche 2). Ce qu'il apporte n'est pas « l'aplat à
    // l'envers » mais une VIGNETTE À GÉOMÉTRIE : la vignette existe déjà par un
    // aplat noir sur un masque à dégradé radial inversé (mesuré le 2026-08-17),
    // et elle est donc RONDE et rien d'autre — l'inversion vivait sur le MASQUE,
    // dont les sources n'ont aucune géométrie. Ici elle vit sur la FORME, ce qui
    // rend atteignables l'hexagone et l'octogone que le catalogue liste, avec la
    // géométrie livrée le 2026-08-17.
    //
    // ⚠️ En FIN de `params[]`, et à 0 par défaut : un preset écrit avant
    // aujourd'hui lit 0 sur un paramètre absent de son document, donc rend
    // exactement ce qu'il rendait. Même raison qu'à l'arrivée de `remplissage`.
    //
    // Sans objet quand rien ne borne : à `borne` = 0 la couverture vaut 1
    // partout, donc l'inverse vaut 0 partout et l'effet ne rendrait plus rien.
    // Et il ne peut pas inverser le MASQUE du calque, qui s'applique en aval de
    // l'effet, dans le compositing.
    {
      name: "inverse",
      label: "Inverser",
      unit: "none",
      min: 0,
      max: 1,
      default: 0,
      step: 1,
      choices: ["Dedans", "Dehors"],
      appliesWhen: { param: "borne", equals: [1, 2, 3] },
      hint: "Peindre AUTOUR de la forme au lieu de dedans. C'est ce qui fait une vignette hexagonale ou octogonale, que la source de masque radiale ne sait pas produire",
    },
  ],
  // Le centre se pose sur la toile plutôt qu'à deux curseurs — c'est
  // exactement le geste que le chantier des contrôles existe pour rendre
  // possible, et une position en pourcentage réglée au curseur est le cas
  // d'école qu'ADR-0017 nomme.
  canvasControls: [
    // ✅ TROISIÈME FRONT DE L'UPGRADE QUALITÉ, livré le 2026-08-18 (ticket 25).
    //
    // C'était un `point` : seul le CENTRE se manipulait sur l'image, largeur,
    // hauteur et rotation restaient au curseur. Le ticket était bloqué parce
    // qu'aucun des trois genres de `CanvasControl` ne savait exprimer une boîte
    // redimensionnable avec rotation.
    //
    // ⚠️ Le quatrième genre n'a demandé AUCUN manipulateur neuf :
    // `TransformHandles` fait déjà huit poignées, une rotation, le magnétisme et
    // l'accès clavier pour le calque photo, et une boîte d'effet est le même
    // objet dans d'autres unités. Voir `ui/boxControl.ts`.
    //
    // Le verdict d'Antoine sur le rectangle à quatre curseurs — « la pire façon
    // de créer un rectangle » — portait sur la CRÉATION, réglée le 2026-08-17
    // par l'outil Forme. Celui-ci règle la RETOUCHE : une forme posée se
    // retouche en la tirant, pas en cherchant quatre curseurs dans le dock.
    {
      id: "boite",
      kind: "box",
      x: "centreX",
      y: "centreY",
      width: "largeur",
      height: "hauteur",
      rotation: "rotation",
      label: "Boîte de la forme",
      visibleWhen: { param: "borne", equals: [1, 2, 3] },
    },
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
      params: ["centreX", "centreY", "largeur", "hauteur", "rotation", "adoucissement", "cotes", "inverse"],
      appliesWhen: { param: "borne", equals: [1, 2, 3] },
    },
    // La couleur et son dégradé sont UNE seule question — « de quoi est faite
    // cette surface » — donc une seule section. Les séparer aurait obligé à
    // l'aller-retour entre deux blocs pour régler une transition dont les deux
    // bouts sont ici.
    {
      id: "couleur",
      label: "Couleur",
      layout: "liste",
      params: ["teinte", "saturation", "clarte", "remplissage", "teinte2", "saturation2", "clarte2", "angleDegrade", "etendueDegrade"],
    },
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

/** Distance signee a un POLYGONE REGULIER de rayon 1, en unites de ce rayon.
 *
 *  Repli angulaire : on ramene l angle dans un seul secteur, ou le bord du
 *  polygone est une DROITE. La distance a cette droite est alors
 *  \`r * cos(angle replie) - cos(demi-secteur)\` — exacte partout sauf tout pres
 *  d un sommet, ou elle sous-estime legerement. Sur un aplat anticrenele au
 *  pixel, cet ecart est sous le seuil de visibilite ; le rendre exact
 *  demanderait une distance a un SEGMENT, donc deux fois le calcul pour un
 *  resultat identique a l oeil.
 *
 *  ⚠️ Le rayon 1 est le rayon CIRCONSCRIT (les sommets), pas l inscrit. Un
 *  hexagone remplit donc sa boite englobante comme le ferait une ellipse, ce qui
 *  est le comportement attendu quand on change de primitive sans toucher aux
 *  curseurs de taille. */
fn aplat_polygone(k: vec2<f32>, cotes: f32) -> f32 {
  let n = max(cotes, 3.0);
  let secteur = 6.2831853 / n;
  let brut = atan2(k.y, k.x);
  let replie = brut - secteur * floor(brut / secteur + 0.5);
  return length(k) * cos(replie) - cos(secteur * 0.5);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let borne = i32(params[0] + 0.5);

  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  let centre = vec2<f32>(params[1], params[2]);

  // COULEUR DE LA SURFACE : unie, ou interpolee entre deux arrets.
  //
  // ⚠️ L INTERPOLATION SE FAIT EN LINEAIRE, et c est le format qui le garantit.
  // Les deux arrets sont convertis AVANT le \`mix\`, donc la transition est celle
  // de la lumiere et non celle des octets encodes — un fondu entre deux teintes
  // melangees en gamma passe par un milieu assombri, defaut classique des
  // degrades faits a la main.
  let encre1 = srgb_to_linear3(hsl2rgb(params[7] / 360.0, params[8], params[9]));
  let modeRemplissage = i32(params[11] + 0.5);
  var encre = encre1;
  if (modeRemplissage != 0) {
    let encre2 = srgb_to_linear3(hsl2rgb(params[12] / 360.0, params[13], params[14]));
    let etendue = max(params[16], 0.02);
    // Position sur le degrade, en espace ISOTROPE : sans \`ar\`, un degrade a 45
    // degres serait couche sur une photo 3:2, et un radial serait un ovale.
    let vers = (uv - centre) * ar;
    var t = 0.0;
    if (modeRemplissage == 1) {
      let angle = params[15] * 0.017453292;
      let axe = vec2<f32>(cos(angle), sin(angle));
      // Centre du degrade au MILIEU de sa course, pas a son debut : c est ce qui
      // fait que bouger l angle pivote le degrade au lieu de le faire glisser.
      t = dot(vers, axe) / etendue + 0.5;
    } else {
      t = length(vers) / etendue;
    }
    encre = mix(encre1, encre2, clamp(t, 0.0, 1.0));
  }

  // BORNEE PAR LE MASQUE : aucune geometrie, couverture pleine. Le compositing
  // en aval multiplie deja par l'opacite et par le masque du calque, donc c'est
  // le pinceau (ou le degrade, la luminosite, le range couleur) qui decide ou
  // la couleur se pose.
  var couverture = 1.0;

  if (borne != 0) {
    // Demi-dimensions en UV. La largeur est exprimee en fraction de la LARGEUR
    // du cadre et la hauteur en fraction de sa HAUTEUR : un carre a l'ecran
    // demande donc deux valeurs differentes, ce qui est le comportement d'un
    // outil de mise en page et non celui d'une primitive isotrope.
    let demi = max(vec2<f32>(params[3], params[4]), vec2<f32>(0.0005)) * 0.5;

    // Rotation autour du CENTRE de la forme, et en espace ISOTROPE : tourner en
    // UV brut cisaillerait le rectangle sur une photo 3:2 au lieu de le tourner.
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
      // ELLIPSE ET POLYGONE : les deux vivent dans le meme espace UNITAIRE
      // \`k = local / demi\`, ou la forme a un rayon de 1 — et surtout ils
      // partagent la MEME conversion en pixels. C'est elle qui compte : sans
      // \`g\`, la distance serait en unites de forme, donc le bord serait deux
      // fois plus doux sur le grand axe que sur le petit. Le defaut exact que le
      // point 1 de l'en-tete refuse, et il se produirait a l'identique sur un
      // polygone etire.
      let k = local / demi;
      let g = length(k / (demi * pxParUv));
      var dUnite = 0.0;
      if (borne == 2) {
        dUnite = length(k) - 1.0;
      } else {
        dUnite = aplat_polygone(k, params[10]);
      }
      distancePx = dUnite / max(g, 0.0001);
    }
    couverture = aplat_couverture(distancePx, params[6]);
    // L INVERSE. Pose ICI et non sur \`melange\` : il doit se prendre sur la
    // couverture ANTICRENELEE, sinon le bord de la vignette redeviendrait dur.
    // Hors du \`if\`, il rendrait \`borne\` = 0 entierement transparent.
    couverture = select(couverture, 1.0 - couverture, params[17] > 0.5);
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


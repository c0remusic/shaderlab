import type { EffectModule } from "./types";
import { HASH_WGSL, VALUE_NOISE_WGSL } from "./hash";
import { UV_SPACE_WGSL } from "./uvSpace";

/**
 * LIGHT LEAK — de la lumière entrée par une fente du boîtier, pas un dégradé
 * orange posé dans un coin.
 *
 * D'OÙ ÇA VIENT. Cahier de références de postproduction (ligne 330) :
 * « dégradés rouge, orange ou jaune ; flou important ; mode `Screen` ; position
 * au bord du cadre ; parfois une légère surexposition de la photo en dessous ».
 * C'est la RECETTE, telle qu'on la ferait à la main dans Photoshop. La recopier
 * telle quelle donnerait exactement le « filtre 2005 » que ce dépôt proscrit —
 * un dégradé peint, dont la couleur ne dit rien et dont la forme ne vient de
 * nulle part. Ce module part du MÉCANISME dont cette recette est l'imitation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'EST UNE FUITE DE LUMIÈRE, et les quatre propriétés qui en découlent
 * ─────────────────────────────────────────────────────────────────────────
 * De la lumière entre par un jeu du dos ou du joint et frappe l'émulsion
 * DIRECTEMENT, sans passer par l'objectif. Quatre conséquences, et chacune est
 * un morceau du modèle ci-dessous plutôt qu'un réglage d'apparence :
 *
 * 1. **Elle entre par un BORD et voyage vers l'intérieur.** D'où une origine
 *    posée sur l'image et une direction, plutôt qu'un « coin » à choisir dans
 *    une liste. Les deux se manipulent sur la toile (`canvasControls`).
 *
 * 2. **Elle est hors de toute mise au point.** La fente est à quelques
 *    millimètres du plan film : ce qui atteint l'émulsion n'est jamais une
 *    image de la fente, c'est un COIN largement étalé qui s'élargit en
 *    avançant. D'où un faisceau dont la largeur CROÎT avec la distance
 *    parcourue (`ouverture`), et non une ellipse floutée.
 *
 * 3. **Sa couleur suit son INTENSITÉ, elle n'est pas choisie.** C'est la
 *    propriété qui sépare cet effet d'un dégradé peint, et c'est elle qui
 *    produit le « rouge, orange ou jaune » du cahier sans qu'on ait à
 *    l'écrire. Les trois couches de l'émulsion ne saturent pas à la même
 *    vitesse sous une lumière chaude et non filtrée : la rouge part la
 *    première, la verte suit, la bleue traîne. On modélise donc chaque canal
 *    par une saturation exponentielle `1 - exp(-e * k)` avec kR > kV > kB.
 *    Une seule formule, et le dégradé sort tout seul :
 *      énergie faible  -> rouge sourd     (seule la couche rouge répond)
 *      énergie moyenne -> orange puis jaune (le vert rattrape)
 *      énergie forte   -> blanc            (les trois couches saturent)
 *    Peindre ce dégradé à trois arrêts de couleur aurait donné la même
 *    palette et aucune des transitions : le blanc n'y serait pas apparu au
 *    cœur, et le rouge n'aurait pas été l'extrémité FAIBLE.
 *
 * 4. **La fente n'est pas propre.** Un jeu de boîtier a des aspérités, donc la
 *    coulée est modulée en basse fréquence sur sa longueur. `irregularite`
 *    module la largeur ET l'énergie avec le même bruit de valeur — les deux
 *    ensemble, parce qu'une fente plus étroite laisse aussi passer moins.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ IL SORT LA FUITE SEULE, IL NE LA MÉLANGE PAS
 * ─────────────────────────────────────────────────────────────────────────
 * Même décision que `texture` (2026-08-05), et pour la même raison. Le calque
 * sait déjà mélanger : `blendMode` et `opacity` sont des champs de
 * `LayerState`, appliqués par le compositing de `shaderCompose`. Un paramètre
 * « Force » ici doublerait l'opacité du calque, et un paramètre « Mélange »
 * doublerait onze modes de fusion par deux ou trois. En rendant la coulée
 * brute, l'effet hérite des onze.
 *
 * `defaultBlendMode: "screen"` parce que c'est le mode que la recette nomme, et
 * qu'il est juste : une fuite AJOUTE de la lumière sans jamais assombrir, et
 * Écran laisse le noir de la coulée parfaitement neutre. Sa « légère
 * surexposition de la photo en dessous » se refait en montant l'opacité ou en
 * passant en Addition — deux clics, pas deux curseurs de plus.
 *
 * ⚠️ **L'ORDRE DES PARAMÈTRES EST GELÉ.** Leur index est persisté dans les
 * presets ; on ajoute à la FIN, jamais au milieu.
 */
export const lightLeak: EffectModule = {
  id: "lightLeak",
  name: "Light leak",
  // Écran : une fuite ajoute de la lumière et n'en retire jamais. À opacité 1,
  // le noir de la coulée laisse l'image dessous intacte au bit près — c'est
  // pour ça que 1 est le bon défaut ici là où `texture` doit descendre à 0,7.
  defaultBlendMode: "screen",
  defaultOpacity: 1,
  params: [
    // ── OÙ ELLE ENTRE ────────────────────────────────────────────────────
    // Défaut sur le bord DROIT (1,0) et au tiers supérieur : une fuite naît
    // d'un jeu du dos, donc au bord, et un centre de cadre n'aurait aucun sens
    // physique. Bornes élargies au-delà du cadre comme les autres centres du
    // registre — l'origine d'une fuite est souvent HORS champ, c'est même le
    // cas le plus courant.
    { name: "origineX", label: "Entrée X", unit: "percent", min: -0.5, max: 1.5, default: 1, step: 0.01, hint: "Point du cadre par lequel la lumière entre. Souvent hors champ : les bornes dépassent le cadre exprès" },
    { name: "origineY", label: "Entrée Y", unit: "percent", min: -0.5, max: 1.5, default: 0.32, step: 0.01, hint: "Voir Entrée X." },
    { name: "direction", label: "Direction", unit: "degrees", min: 0, max: 360, default: 195, step: 1, hint: "Sens dans lequel la coulée traverse le cadre depuis son entrée" },
    { name: "portee", label: "Portée", unit: "percent", min: 0.05, max: 1.5, default: 0.62, step: 0.01, hint: "Distance parcourue avant extinction, en fraction du cadre" },

    // ── LA FORME DU FAISCEAU ─────────────────────────────────────────────
    // 0,30 et non 0,13 depuis le 2026-08-13. Un joint de porte qui a lâché
    // fuit sur toute sa LONGUEUR : ce qui entre est une bande, pas un pinceau.
    // À 0,13 la coulée se lisait comme un faisceau posé sur la photo — le
    // « lampe torche » qu'Antoine a refusé.
    { name: "largeur", label: "Largeur à l'entrée", unit: "percent", min: 0.01, max: 0.8, default: 0.17, step: 0.005, hint: "Largeur de la coulée au point d'entrée — la taille de la fente" },
    {
      name: "ouverture",
      label: "Ouverture",
      unit: "none",
      min: 0,
      max: 3,
      // 0,6 et non 1,1 : combinée à une entrée large, une ouverture forte
      // dessinait un COIN, donc une figure géométrique. Une fuite de bord
      // s'évase à peine — c'est sa décroissance vers l'intérieur qu'on lit,
      // pas son angle.
      default: 0.6,
      step: 0.05,
      // À 0 la coulée est une BANDE de largeur constante, ce qui est le cas
      // limite d'une fente très longue. Au-delà, elle s'ouvre en coin, ce qui
      // est le cas ordinaire — et c'est ce qui distingue une fuite d'un simple
      // dégradé linéaire.
      hint: "De combien le faisceau s'élargit en avançant. 0 = une bande de largeur constante ; au-delà, un coin",
    },
    {
      name: "attenuation",
      label: "Atténuation",
      unit: "none",
      min: 0.2,
      max: 4,
      default: 1.5,
      step: 0.05,
      // Exposant de la décroissance le long du trajet. Bas = la coulée
      // traverse le cadre en gardant sa force (fuite franche) ; haut = elle
      // meurt près du bord (jeu minuscule).
      hint: "Vitesse d'extinction le long du trajet. Bas = la coulée traverse ; haut = elle meurt près du bord",
    },

    // ── L'ÉMULSION ───────────────────────────────────────────────────────
    // 0,70 et non 1,35 : à 1,35 les trois couches saturaient ensemble au cœur,
    // qui sortait BLANC — donc le dégradé chaud ne se lisait plus qu'en marge,
    // exactement le défaut que le ROADMAP prédisait et que la mesure a
    // confirmé. Les sources décrivent un voile orange, rouge ou magenta ; le
    // blanc n'appartient qu'à la surexposition franche, qui reste à un curseur.
    { name: "intensite", label: "Intensité", unit: "none", min: 0, max: 4, default: 0.7, step: 0.05, hint: "Quantité de lumière entrée. C'est elle qui décide de la COULEUR autant que de la force — voir Chaleur" },
    {
      name: "chaleur",
      label: "Chaleur",
      unit: "percent",
      min: 0,
      max: 1,
      // 0,78 et non 0,55 : les sources décrivent un voile ORANGE, ROUGE ou
      // MAGENTA, jamais rose pâle. À 0,55 les trois couches suivaient d'assez
      // près pour que la zone dense vire au blanc rosé dès que l'énergie monte,
      // et la couleur ne se lisait plus que sur la frange.
      default: 0.78,
      step: 0.01,
      // Écart entre les vitesses de saturation des trois couches. À 0, les
      // trois répondent presque ensemble et la coulée est blanche partout — de
      // la lumière parasite neutre, ce qui arrive avec un boîtier clair. À 1
      // l'écart est maximal et il faut beaucoup d'énergie pour que le bleu
      // suive : la coulée reste rouge sur presque toute sa longueur.
      hint: "Écart de sensibilité entre les trois couches du film. 0 = coulée blanche et neutre ; 1 = rouge tenace, le blanc ne vient qu'au cœur",
    },

    // ── L'IRRÉGULARITÉ DE LA FENTE ───────────────────────────────────────
    // 0,15 et non 0,38 : à 0,38 le bord festonnait au point que la coulée se
    // lisait comme un nuage et non comme de la lumière entrée par une fente.
    { name: "irregularite", label: "Irrégularité", unit: "percent", min: 0, max: 1, default: 0.15, step: 0.01, hint: "Aspérités de la fente : elles modulent la largeur ET la force ensemble, comme un vrai jeu de boîtier" },
    { name: "echelleBruit", label: "Grain de l'irrégularité", unit: "none", min: 1, max: 24, default: 5.5, step: 0.5, hint: "Grand = quelques ondulations lentes ; petit… l'inverse. Au-delà de ~16 la coulée se hache et cesse de se lire comme de la lumière" },
    { name: "graine", label: "Graine", unit: "none", min: 0, max: 64, default: 0, step: 1, hint: "Change le tirage de l'irrégularité sans rien changer d'autre" },
  ],
  /**
   * ⚠️ LES DEUX CONTRÔLES POSÉS SONT LE CŒUR DE CET EFFET, pas un confort.
   * Le point 5 du tri du cahier le dit pour cette recette précise : « plusieurs
   * recettes demandent une GÉOMÉTRIE posée sur l'image, pas des curseurs :
   * masque radial près de la source, dégradé de light leak au bord du cadre ».
   * Régler « Entrée X = 1,04 » au curseur pendant qu'on regarde ailleurs est
   * exactement le geste que ce chantier existe pour supprimer.
   *
   * Les quatre paramètres qu'ils pilotent restent DANS LA MÊME SECTION : un
   * contrôle de toile est un bloc atomique que `groupEffectParams` refuse de
   * couper en deux.
   */
  canvasControls: [
    { id: "entree", kind: "point", x: "origineX", y: "origineY", label: "Entrée de la lumière" },
    { id: "trajet", kind: "axis", angle: "direction", length: "portee", label: "Trajet" },
  ],
  /**
   * QUATRE SECTIONS, ET AUCUNE CONDITION. Cet effet n'a aucun mode exclusif :
   * ses douze paramètres servent toujours, et un `appliesWhen` viserait de
   * toute façon un paramètre à `choices` qu'il ne déclare pas (voie A).
   *
   * Le découpage suit les quatre questions du mécanisme, dans l'ordre où elles
   * se posent : par où la lumière entre (*Fuite*), quelle forme prend la coulée
   * (*Faisceau*), comment l'émulsion y répond (*Émulsion* — c'est là que la
   * couleur se décide), et à quel point la fente est sale (*Irrégularité*).
   */
  sections: [
    { id: "fuite", label: "Fuite", layout: "pose", params: ["origineX", "origineY", "direction", "portee"] },
    { id: "faisceau", label: "Faisceau", layout: "liste", params: ["largeur", "ouverture", "attenuation"] },
    { id: "emulsion", label: "Émulsion", layout: "liste", params: ["intensite", "chaleur"] },
    { id: "irregularite", label: "Irrégularité", layout: "liste", params: ["irregularite", "echelleBruit", "graine"] },
  ],
  wgsl: `
${HASH_WGSL}${VALUE_NOISE_WGSL}${UV_SPACE_WGSL}

// Vitesse de saturation commune aux trois couches, en NEUTRE (chaleur = 0).
// Elles sont volontairement egales a ce reglage : c'est \`chaleur\` qui les
// ecarte, donc a 0 la coulee est blanche et l'effet ne fait plus que doser de
// la lumiere.
const LEAK_BASE = 2.2;
// Ecart RELATIF entre les couches, atteint a chaleur = 1 : le rouge accelere,
// le vert et surtout le bleu ralentissent. MULTIPLICATIF et non additif — une
// addition aurait laisse le bleu a une vitesse elevee, donc une coulee blanche
// meme a chaleur maximale, et le curseur n'aurait rien fait de visible.
//
// Ce que ces trois nombres donnent, mesure a chaleur = 1 :
//   energie 0,2 -> (0,68 · 0,25 · 0,12)  rouge sourd
//   energie 1,0 -> (1,00 · 0,76 · 0,46)  orange puis jaune
//   energie 3,0 -> (1,00 · 0,99 · 0,84)  blanc chaud au coeur
// C'est exactement le « rouge, orange ou jaune » du cahier, obtenu sans
// qu'aucune de ces trois couleurs ne soit ecrite nulle part.
const LEAK_ECART = vec3<f32>(1.6, -0.35, -0.72);

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let intensite = params[7];
  // Sortie NOIRE quand l'effet est eteint. En Ecran, du noir est l'identite
  // exacte : le calque devient inerte au bit pres au lieu de rendre un voile.
  if (intensite <= 0.0) {
    return vec4<f32>(0.0, 0.0, 0.0, color.a);
  }

  // ESPACE ISOTROPE. Une coulee est une geometrie : exprimee en UV bruts, sa
  // largeur et sa portee vaudraient des pixels differents sur les deux axes des
  // que l'image n'est pas carree, et le faisceau se deformerait en tournant.
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  let p = (uv - vec2<f32>(params[0], params[1])) * ar;

  let angle = params[2] * 0.017453292;
  let axe = vec2<f32>(cos(angle), sin(angle));
  // Normale a l'axe, pour mesurer l'ecart LATERAL au trajet.
  let normale = vec2<f32>(-axe.y, axe.x);

  let portee = max(params[3], 0.001);
  // t : distance parcourue le long du trajet, normalisee par la portee.
  // s : ecart lateral, en unites d'espace isotrope.
  let t = dot(p, axe) / portee;
  let s = dot(p, normale);

  // DERRIERE L'ENTREE, RIEN. La lumiere ne remonte pas la fente : sans cette
  // borne la coulee serait symetrique et se lirait comme une bande traversante,
  // ce qui est precisement ce qu'une fuite n'est pas.
  if (t < 0.0 || t > 1.0) {
    return vec4<f32>(0.0, 0.0, 0.0, color.a);
  }

  // IRREGULARITE. Un seul echantillon de bruit, LE LONG du trajet — pas un
  // champ 2D. Une fente varie sur sa longueur, pas en travers : un bruit 2D
  // aurait mouchete la coulee au lieu de la faire onduler.
  let echelle = max(params[10], 0.5);
  let n = valueNoise(vec2<f32>(t * echelle, params[11] * 7.31));
  // Centre sur 0, donc l'irregularite ne DEPLACE pas la moyenne : a n = 0.5 la
  // coulee est exactement celle qu'on aurait sans elle. Sans ce centrage, monter
  // le curseur eclaircirait ou assombrirait l'ensemble, ce qui serait un reglage
  // d'intensite deguise.
  let ondulation = (n - 0.5) * 2.0 * params[9];

  // LARGEUR QUI CROIT AVEC LA DISTANCE — la propriete qui distingue un coin
  // d'un degrade. \`ouverture\` a 0 rend une bande de largeur constante.
  let demiLargeur = max(params[4] * (1.0 + params[5] * t) * (1.0 + ondulation * 0.6), 0.0005);

  // Profil LATERAL en cosinus releve : nul au bord du faisceau, derivee nulle
  // au bord aussi, donc aucun liseré a la limite. Un gaussien aurait une queue
  // infinie qui voilerait tout le cadre ; un smoothstep laisserait une arete de
  // derivee au raccord, visible sur un aplat sombre.
  // BASE ELARGIE ET SOMMET MOINS PLAT. Le profil s'etendait jusqu'a
  // \`demiLargeur\` exactement : au-dela, zero franc. La coulee avait donc un
  // CONTOUR — une forme identifiable posee sur la photo, ce qu'Antoine a
  // resume par « tres lampe torche, tres grossier » le 2026-08-13. Un voile de
  // fuite n'a pas de bord : il s'eteint sans qu'on puisse dire ou.
  //
  // La base porte maintenant deux fois plus loin, et l'elevation a la puissance
  // 1,6 creuse le sommet — le plateau central etait l'autre moitie du defaut,
  // puisque sature il rendait un cœur uniformement blanc au lieu d'un degrade.
  // La queue reste FINIE, ce qui etait la raison du cosinus releve : un gaussien
  // voilerait tout le cadre.
  let q = clamp(abs(s) / (demiLargeur * 2.0), 0.0, 1.0);
  let profil = 0.5 + 0.5 * cos(q * 3.14159265);
  let lateral = pow(profil, 1.6);

  // EXTINCTION le long du trajet. Le facteur (1 - t) garantit qu'elle atteint
  // exactement zero a la portee : une exponentielle aurait laisse un residu
  // coupe net au bout, soit l'arete que tout ce module evite.
  let longitudinal = pow(1.0 - t, params[6]);

  // L'irregularite module la FORCE en meme temps que la largeur, et avec le
  // meme bruit : une fente plus etroite laisse aussi passer moins de lumiere.
  // Les separer aurait demande un second curseur pour un seul phenomene.
  let energie = intensite * lateral * longitudinal * (1.0 + ondulation * 0.45);

  // REPONSE DE L'EMULSION. Trois saturations exponentielles a vitesses
  // differentes — c'est ici, et nulle part ailleurs, que la couleur se decide.
  let k = vec3<f32>(LEAK_BASE) * (vec3<f32>(1.0) + LEAK_ECART * params[8]);
  let coulee = vec3<f32>(1.0) - exp(-max(energie, 0.0) * k);

  // LA COULEE SEULE. Le mode de fusion du calque et son opacite font le
  // melange — d'ou l'absence de parametres « Melange » et « Force » ici.
  return vec4<f32>(coulee, color.a);
}
`,
};

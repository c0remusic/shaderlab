import type { EffectModule } from "./types";

/**
 * TEXTURE — pose un scan de la bibliothèque sur l'image.
 *
 * PREMIER EFFET DU REGISTRE QUI ÉCHANTILLONNE UNE IMAGE. Tous les autres ne
 * lisent que ce qui est en dessous d'eux ; celui-ci désigne un fichier. Ce qui
 * le rend possible est `EffectModule.libraryTexture` : `LayerState.params` est
 * un `Record<string, number>` (l'uniform est `array<f32, MAX_EFFECT_PARAMS>`),
 * donc un paramètre ne peut porter qu'un NOMBRE — ici le RANG de la texture
 * dans le catalogue trié du dossier. Les pixels arrivent par le binding 7,
 * résolus par `render/textureLibraryStore.ts`.
 *
 * ⚠️ **IL SORT LA TEXTURE, IL NE LA MÉLANGE PAS.** C'est la décision qui donne
 * sa forme à tout le reste (arbitrage d'Antoine, 2026-08-05). Le premier jet
 * portait ses propres paramètres « Mélange » (quatre modes) et « Force » ;
 * les deux DOUBLONNAIENT ce que le calque sait déjà faire — `blendMode` et
 * `opacity` sont des champs de `LayerState`, appliqués par le compositing de
 * `shaderCompose`. En rendant le scan brut, l'effet hérite des **onze** modes
 * du registre de fusion au lieu de quatre, et de l'opacité du calque au lieu
 * d'un second curseur qui dirait la même chose.
 *
 * Ne restent donc ici que les réglages qu'un calque ne sait PAS exprimer : quel
 * scan, à quelle échelle, tourné comment, décalé où, et deux transformations de
 * sa matière (inversion, désaturation).
 *
 * ⚠️ **L'ORDRE DES PARAMÈTRES EST GELÉ.** Leur index est persisté dans les
 * presets ; on ajoute à la FIN, jamais au milieu.
 *
 * ⚠️ **`rang` est une position, pas une identité.** Ajouter un fichier au
 * dossier décale les rangs suivants, donc un preset enregistré avant peut
 * désigner une autre texture. Même classe de problème que l'exclusion
 * d'`imageSource` des presets, et traitée pareil : en le disant.
 *
 * ─── LE SCAN SE POSE QUELQUE PART (2026-08-27, ticket 21) ──────────────────
 *
 * Il couvrait le cadre entier et n'avait donc aucun LIEU : même l'outil
 * Déplacer branché (ticket 20) n'avait rien à prendre. Cinq paramètres de boîte
 * lui en donnent un, et le choix de conception tient en une phrase — **la boîte
 * BORNE et ANCRE, elle ne DIMENSIONNE pas** :
 *
 * - elle BORNE : hors d'elle, `fs_main` rend son entrée telle quelle, le motif
 *   ne se dessine que dedans ;
 * - elle ANCRE : son centre et son angle sont le repère où `Échelle`,
 *   `Rotation` et `Décalage` s'appliquent — donc déplacer la boîte emmène le
 *   motif avec elle, au lieu de faire glisser une fenêtre sur un motif
 *   immobile. C'est ce que « poser un scan quelque part » veut dire ;
 * - elle ne DIMENSIONNE pas : agrandir la boîte montre plus de motif, jamais un
 *   motif plus gros. C'est `Échelle` qui le dimensionne, et elle existait déjà.
 *   Les deux façons de dire la même chose auraient été le vrai coût de cet
 *   ajout, dans un effet qui porte déjà quatre réglages de placement.
 *
 * ⚠️ **Ses défauts SONT le comportement d'avant, au bit près** — plein cadre,
 * angle nul —, et deux détails d'écriture le garantissent plutôt que de
 * l'espérer : la rotation de la boîte est écrite sans aller-retour par le
 * facteur d'aspect (une multiplication suivie de sa division n'est pas
 * l'identité en flottant), et sa rampe d'anticrénelage est posée à l'EXTÉRIEUR
 * du bord, de sorte que tout pixel dont le centre est dans la boîte reçoive
 * exactement 1. Voir les commentaires du corps WGSL.
 */
export const texture: EffectModule = {
  id: "texture",
  name: "Texture",
  libraryTexture: { indexParam: "rang" },
  // Un calque de texture posé en `normal` à opacité 1 CACHE la photo : le
  // premier geste serait toujours de corriger les deux. Incrustation préserve
  // le contraste de l'image dessous et fait ressortir la matière ; 0,7 laisse
  // la photo mener. Les deux se changent d'un clic dans les contrôles du calque.
  defaultBlendMode: "overlay",
  defaultOpacity: 0.7,
  params: [
    {
      name: "rang",
      label: "Texture",
      min: 0,
      // Borne HAUTE ARBITRAIRE, et c'est une dette assumée : le vrai maximum
      // est la taille du catalogue, que `params` ne peut pas connaître —
      // `maxFrom` ne reçoit que des paramètres, jamais l'état de la
      // bibliothèque. Un rang hors catalogue rend la texture de repli, donc
      // l'effet devient inerte au lieu de casser. Le sélecteur à vignettes de
      // `ParamPanel` est ce qui rend ce paramètre utilisable ; ce curseur n'est
      // que son repli.
      max: 63,
      default: 0,
      step: 1,
      unit: "none",
      hint: "Rang de la texture dans le dossier de la bibliothèque, par ordre alphabétique.",
    },
    {
      name: "echelle",
      label: "Échelle",
      min: 0.1,
      max: 4,
      // 1 : le scan couvre le cadre UNE FOIS. C'est ce pour quoi un scan
      // d'overlay est fait — son vignetage, ses plis et ses bords SONT l'effet,
      // et les répéter produit un motif qui se lit comme un filtre.
      //
      // ⚠️ Ce défaut a d'abord été mis à 0,5 pour « donner du grain », c'est-à-dire
      // pour compenser des textures plates. Mesure du 2026-08-05 : les scans PBR
      // du dossier ont une étendue moyenne de **10 niveaux sur 255** (Paper005 :
      // UN seul). Répéter un aplat rend un aplat — le réglage soignait le
      // symptôme et abîmait le cas nominal.
      default: 1,
      step: 0.01,
      unit: "none",
      hint: "Taille de la texture. Au-delà du cadre elle se répète.",
    },
    {
      name: "rotation",
      label: "Rotation",
      min: -180,
      max: 180,
      default: 0,
      step: 1,
      unit: "degrees",
      hint: "Un scan n'a pas de haut : le tourner varie le rendu sans rien coûter.",
    },
    { name: "decalageX", label: "Décalage X", min: -1, max: 1, default: 0, step: 0.001, unit: "none" },
    { name: "decalageY", label: "Décalage Y", min: -1, max: 1, default: 0, step: 0.001, unit: "none" },
    {
      name: "inversion",
      label: "Inverser",
      min: 0,
      max: 1,
      default: 0,
      step: 0.01,
      unit: "percent",
      // Continu et non binaire : une inversion partielle aplatit le contraste
      // du scan, ce qui est un réglage utile en soi. Même raison que le
      // `monochrome` de `channelMixer`, délibérément continu.
      hint: "Retourne le contraste du scan. Un papier sombre devient clair.",
    },
    {
      name: "desaturation",
      label: "Désaturation",
      min: 0,
      max: 1,
      default: 0,
      step: 0.01,
      unit: "percent",
      hint: "Retire la teinte du scan — un carton brun cesse de brunir l'image.",
    },
    // ── Ajoutés le 2026-08-05, À LA FIN : l'index d'un paramètre est persisté
    // dans les presets. Ils forment ensemble le « Levels » que le cahier de
    // références prescrit sur tout scan d'overlay (ligne 325), et sans lequel
    // les scans réellement disponibles sont inexploitables.
    {
      name: "contraste",
      label: "Contraste",
      min: 1,
      max: 24,
      default: 1,
      step: 0.1,
      unit: "none",
      // Course jusqu'à 24, ce qui paraît énorme et ne l'est pas : un scan à
      // 10 niveaux d'étendue (la moyenne mesurée du dossier) a besoin d'un gain
      // de ~15 pour atteindre les 150 niveaux d'un vrai scan de papier. Un
      // maximum de 4 aurait fait un curseur qui « ne fait rien » sur la matière
      // qu'on a réellement sous la main.
      hint: "Étire le contraste du scan autour du point médian. Indispensable sur un scan plat.",
    },
    {
      name: "pivot",
      label: "Point médian",
      min: 0,
      max: 1,
      default: 0.5,
      step: 0.01,
      unit: "none",
      // Le pivot ne peut PAS être deviné : la moyenne d'un scan varie de 139 à
      // 223 sur les huit du dossier. Étirer autour de 0,5 un papier dont la
      // moyenne est à 0,87 le fait saturer en blanc au lieu de révéler sa
      // matière. Le régler à l'œil est immédiat — l'image répond en direct.
      hint: "Valeur du scan qui ne bouge pas quand on monte le contraste. À caler sur sa teinte dominante. Sans objet tant que le contraste vaut 1, où l'étirement est l'identité.",
    },

    // ─── LA BOÎTE (2026-08-27, ticket 21) ─────────────────────────────────
    // CINQ PARAMÈTRES, TOUS À LA FIN, sans exception : les index 0 à 8 sont
    // gelés par la référence `effet-texture` et par les presets. Un ajout au
    // milieu les décalerait en silence — le shader lirait `params[9]` là où un
    // preset a écrit autre chose, et aucun test ne le dirait.
    //
    // ⚠️ LEURS DÉFAUTS SONT LE COMPORTEMENT ACTUEL, EXACTEMENT : une boîte
    // centrée (0,5 ; 0,5), de la taille du cadre (1 × 1), non tournée. Le
    // shader retombe alors sur les mêmes opérations qu'avant — la rotation de
    // boîte à 0 est l'identité au bit près (`x*1 + y*k*0`), la couverture vaut
    // exactement 1 sur tout pixel dont le centre est dans la boîte, et
    // `mix(color, scan, 1.0)` rend `scan` sans arrondi. C'est ce qui permet à
    // `effet-texture` de ne pas bouger d'un octet.
    //
    // ⚠️ Les DEUX ROTATIONS de cet effet ne font pas la même chose et le libellé
    // le dit : `rotation` (section Placement) tourne le MOTIF dans la boîte,
    // celle-ci tourne LA BOÎTE et son contenu avec elle. C'est le seul endroit
    // du registre où deux angles cohabitent, d'où le libellé long plutôt qu'un
    // second « Rotation » nu.
    { name: "boiteX", label: "Centre X", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.001, hint: "Où le scan se pose. Se manipule sur l'image" },
    { name: "boiteY", label: "Centre Y", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.001 },
    {
      name: "boiteLargeur",
      label: "Largeur",
      unit: "percent",
      min: 0.01,
      max: 2,
      default: 1,
      step: 0.005,
      // En fraction de la LARGEUR du cadre, comme `aplat` : un carré à l'écran
      // demande donc deux valeurs différentes. Au-delà de 1 la boîte déborde,
      // ce qui est le cas normal d'un scan qu'on veut voir sortir du cadre.
      //
      // ⚠️ ELLE NE REDIMENSIONNE PAS LE SCAN. La taille du motif est `Échelle`,
      // qui existait déjà ; la boîte dit jusqu'où il se dessine. Les confondre
      // aurait donné deux façons de dire la même chose, et un scan étiré par sa
      // fenêtre — ce qu'aucun outil de placement ne fait.
      hint: "Étendue de la boîte, en fraction de la largeur du cadre. Elle borne où le scan se dessine ; sa TAILLE reste réglée par Échelle",
    },
    { name: "boiteHauteur", label: "Hauteur", unit: "percent", min: 0.01, max: 2, default: 1, step: 0.005 },
    {
      name: "boiteRotation",
      label: "Rotation de la boîte",
      unit: "degrees",
      min: -180,
      max: 180,
      default: 0,
      step: 1,
      hint: "Tourne la boîte ET le motif qu'elle contient, comme on tournerait une image posée. Distincte de Rotation, qui ne tourne que le motif à l'intérieur",
    },
  ],
  /**
   * LE SCAN SE POSE QUELQUE PART (ticket 21, liste arrêtée par Antoine le
   * 2026-08-27). C'est le SEUL des quatre effets de ce ticket qui gagne des
   * paramètres : les trois autres avaient déjà leur centre, celui-ci couvrait le
   * cadre entier et n'avait aucun lieu.
   *
   * ⚠️ POURQUOI UNE `box` ET PAS UN `point`. Poser un scan demande de dire
   * jusqu'OÙ il se pose, pas seulement où il est centré — c'est une surface, pas
   * une source. Le genre existe depuis le 2026-08-18 (`aplat`, ticket 25) et
   * n'a demandé aucun manipulateur neuf ; l'hôte sait déjà rendre huit poignées
   * et une rotation (`ui/boxControl.ts`).
   *
   * ── CE QUE LA BOÎTE FAIT, ET CE QU'ELLE NE FAIT PAS ────────────────────────
   *
   * Elle BORNE (hors d'elle, l'image passe telle quelle) et elle ANCRE (son
   * centre et son angle sont le repère où `Échelle`, `Rotation` et `Décalage`
   * s'appliquent). Elle ne DIMENSIONNE pas : agrandir la boîte montre plus de
   * motif, jamais un motif plus gros. C'est ce partage qui évite le doublon avec
   * les quatre réglages de placement déjà présents — et c'est aussi ce qui fait
   * qu'un glissement de l'outil Déplacer emmène le motif avec la boîte, au lieu
   * de faire glisser une fenêtre sur un motif immobile.
   *
   * ⚠️ « L'IMAGE PASSE INCHANGÉE » EST VRAI DE CE QUE L'EFFET REND, pas
   * forcément de ce que le calque compose. Hors de la boîte, `fs_main` rend son
   * entrée telle quelle — le même geste que le repli 1×1 ci-dessous — mais le
   * compositing applique ensuite `blend(color, effected)`, et cet effet est posé
   * en Incrustation par défaut, mode pour lequel `overlay(c, c)` n'est pas
   * l'identité. Un effet ne peut pas neutraliser son propre calque : sur le
   * chemin de compositing, `shaderCompose` ne lit que `effected.rgb` et tire son
   * poids de l'opacité et du masque, jamais de l'alpha rendu. Le repli honnête
   * reste donc le masque du calque ; à défaut, poser le calque en Normal.
   */
  canvasControls: [
    {
      id: "boite",
      kind: "box",
      x: "boiteX",
      y: "boiteY",
      width: "boiteLargeur",
      height: "boiteHauteur",
      rotation: "boiteRotation",
      label: "Boîte du motif",
    },
  ],
  /**
   * CINQ SECTIONS, ET AUCUNE CONDITION — le seul effet du registre qui n'en
   * portait aucune, faute d'être arrivé pendant le chantier qui les a posées
   * (livré le 2026-08-05 sur `master` pendant que les vingt et une autres se
   * sectionnaient sur une branche ; la fusion l'a signalé plutôt que de le
   * taire). Sectionné ici, à l'identique du reste du registre.
   *
   * ⚠️ AUCUN `appliesWhen` N'EST EXPRIMABLE ICI, et ce n'est pas un oubli :
   * `appliesWhen` vise un paramètre à `choices` et rien d'autre (voie A, design
   * §3), or cet effet n'en déclare AUCUN — ses neuf paramètres sont continus.
   * Le seul cas d'inertie qu'il porte est d'ailleurs continu lui aussi : à
   * contraste 1, l'étirement `(g − p) × 1 + p` est l'identité et `pivot` ne
   * déplace plus rien. Un seuil sur un curseur est exactement ce que la voie A
   * refuse d'exprimer en contrat ; la déclaration reste donc en prose, dans
   * l'infobulle de `pivot`, comme les trois de `gradientMap`.
   *
   * ⚠️ `params[]` NE BOUGE PAS — les index sont persistés dans les presets, et
   * `contraste`/`pivot` sont en fin de table pour cette raison exacte. Les
   * sections sont déclarées dans l'ordre des index, qui est aussi celui où les
   * blocs s'ouvriront : une section s'ouvre à la place de son PREMIER
   * paramètre.
   *
   * CE QUE LE DÉCOUPAGE SÉPARE, ce sont cinq questions qui ne se posent pas
   * au même moment : QUELLE matière (*Scan*), posée COMMENT dans son repère
   * (*Placement*), retournée ou décolorée (*Matière*), étirée jusqu'où
   * (*Niveaux*), et posée OÙ sur la photo (*Boîte*). *Matière* et *Niveaux* se
   * ressemblent et ne font pas la même chose : *Matière* transforme le scan,
   * *Niveaux* le rend simplement VISIBLE — sans lui, les scans réellement
   * disponibles ont une étendue moyenne de dix niveaux sur 255 et ne se voient
   * pas (mesure du 2026-08-05, voir le commentaire de `contraste`).
   *
   * *Placement* est la seule `grille` : quatre libellés courts, deux fois moins
   * de lignes. *Scan* rend un sélecteur à vignettes et non un curseur, et
   * *Matière* / *Niveaux* portent des libellés que deux colonnes tronqueraient.
   *
   * ⚠️ *Boîte* est en `pose` et cite les CINQ champs du contrôle de toile, ni
   * plus ni moins. Un contrôle de toile est un BLOC ATOMIQUE : une section qui
   * n'en citerait qu'une partie laisserait l'en-tête « sur la toile » sans ses
   * réglages, ou l'inverse — `groupEffectParams` lève au lieu de le rendre.
   */
  sections: [
    { id: "scan", label: "Scan", layout: "liste", params: ["rang"] },
    { id: "placement", label: "Placement", layout: "grille", params: ["echelle", "rotation", "decalageX", "decalageY"] },
    { id: "matiere", label: "Matière", layout: "liste", params: ["inversion", "desaturation"] },
    { id: "niveaux", label: "Niveaux", layout: "liste", params: ["contraste", "pivot"] },
    { id: "boite", label: "Boîte", layout: "pose", params: ["boiteX", "boiteY", "boiteLargeur", "boiteHauteur", "boiteRotation"] },
  ],
  wgsl: `
// Transferts sRGB LOCAUX, prefixes, plutot que les helpers partages de
// shaderCompose : ceux-ci ne sont injectes que sur le chemin de compositing
// (applyMask), et un effet ne doit pas dependre de la passe qui l'appelle.
fn tex_lin2srgb(c: vec3<f32>) -> vec3<f32> {
  let s = max(c, vec3<f32>(0.0));
  let lo = s * 12.92;
  let hi = 1.055 * pow(s, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
  return select(hi, lo, s <= vec3<f32>(0.0031308));
}

fn tex_srgb2lin(c: vec3<f32>) -> vec3<f32> {
  let s = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  let lo = s / 12.92;
  let hi = pow((s + vec3<f32>(0.055)) / vec3<f32>(1.055), vec3<f32>(2.4));
  return select(hi, lo, s <= vec3<f32>(0.04045));
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // REPLI 1x1 : le store sert une texture minuscule tant que le decodage n'est
  // pas fini, precisement pour que ce corps reste une chaine fixe. Rendre
  // l'entree telle quelle est le moins faux disponible pendant cette frame.
  let dims = textureDimensions(libraryTexture);
  if (dims.x <= 1u || dims.y <= 1u) {
    return color;
  }

  let echelle = max(params[1], 0.01);
  let angle = params[2] * 0.017453292;
  let decalage = vec2<f32>(params[3], params[4]);
  let inversion = params[5];
  let desaturation = params[6];

  // ─── LA BOITE : le REPERE du motif, et la borne de son trace ─────────────
  //
  // Le cadre vient de srcTexture et non de libraryTexture : c est la photo qui
  // donne les pixels, donc l anticrenelage et le rapport d aspect.
  let cadre = vec2<f32>(textureDimensions(srcTexture));
  let boiteCentre = vec2<f32>(params[9], params[10]);
  // Demi-etendues en fraction du cadre, bornees comme celles d aplat : une
  // boite de taille nulle rendrait une division par zero cote manipulateur.
  let boiteDemi = max(vec2<f32>(params[11], params[12]), vec2<f32>(0.0005)) * 0.5;
  let boiteAngle = params[13] * 0.017453292;
  let cb = cos(boiteAngle);
  let sb = sin(boiteAngle);
  let ecart = uv - boiteCentre;
  // ROTATION ISOTROPE, ECRITE SANS ALLER-RETOUR. La forme usuelle du depot
  // (aplat) multiplie par aspectScale, tourne, puis redivise : cette
  // multiplication suivie de sa division n est PAS l identite en flottant, et
  // cet effet a besoin qu elle le soit — sa reference existante est prise a
  // rotation nulle, ou tout doit retomber au bit pres. Le facteur d aspect est
  // donc porte par les deux termes CROISES, qui s annulent exactement quand
  // sin vaut 0 : local devient alors ecart, sans arrondi.
  let local = vec2<f32>(
    ecart.x * cb + ecart.y * (cadre.y / cadre.x) * sb,
    ecart.y * cb - ecart.x * (cadre.x / cadre.y) * sb
  );

  // COUVERTURE. Distance de Tchebychev au rectangle, ramenee en PIXELS : le
  // bord s adoucit donc de la meme epaisseur sur les deux axes, quelle que soit
  // la taille de la boite — meme correction que le bord d aplat.
  //
  // ⚠️ LA RAMPE EST POSEE A L EXTERIEUR DU BORD (de 0 a +1 pixel), pas a cheval
  // dessus. Deux raisons. La premiere est exacte : tout pixel dont le CENTRE
  // est dans la boite recoit exactement 1, donc la boite par defaut — plein
  // cadre — rend le scan tel quel et la reference effet-texture ne bouge pas.
  // Une rampe a cheval poserait la rangee de pixels du bord pile sur la valeur
  // 1, a l epsilon d interpolation de uv pres, et cet epsilon suffit a deplacer
  // un octet. La seconde est un demi-pixel de biais vers l exterieur, invisible,
  // et il va dans le sens sur : une boite ne mange jamais le pixel qu elle
  // contient.
  let q = (abs(local) - boiteDemi) * cadre;
  let couverture = clamp(1.0 - max(q.x, q.y), 0.0, 1.0);

  // Rotation autour du CENTRE de la boite, puis echelle, puis decalage. Tourner
  // autour de l'origine ferait fuir la texture hors du cadre des que l'angle
  // bouge, ce qui rendrait le curseur inutilisable.
  //
  // C est local et non uv - 0.5 : le motif est ancre a la BOITE, donc deplacer
  // la boite deplace le scan avec elle au lieu de faire glisser une fenetre sur
  // un motif immobile. Au reglage par defaut (centre 0,5 et angle nul) local
  // vaut exactement uv - 0.5, l expression d avant.
  let s = sin(angle);
  let c = cos(angle);
  let tourne = vec2<f32>(local.x * c - local.y * s, local.x * s + local.y * c);
  // fract : la texture se REPETE hors de ses bornes. Un clamp etirerait le
  // pixel de bord en trainee, ce qui se voit immediatement sur un papier.
  let tuv = fract(tourne / echelle + vec2<f32>(0.5) + decalage);

  var scan = textureSample(libraryTexture, srcSampler, tuv).rgb;

  // LEVELS, en espace GAMMA. Meme convention que les modes de fusion
  // definis-gamma du depot (blend/modes.ts) : etirer en lineaire deplacerait
  // le point median PERCU, et le curseur ne repondrait pas la ou l'oeil
  // l'attend.
  //
  // Ce bloc est ce qui rend exploitable un scan plat. Mesure du 2026-08-05 sur
  // le dossier CC0 : etendue moyenne de 10 niveaux sur 255, contre 100 a 200
  // pour un vrai scan d'overlay. Sans etirement, la matiere est LA mais reste
  // sous le seuil de visibilite.
  let contraste = max(params[7], 0.0);
  let pivot = params[8];
  var gamma = tex_lin2srgb(scan);
  gamma = clamp((gamma - vec3<f32>(pivot)) * contraste + vec3<f32>(pivot), vec3<f32>(0.0), vec3<f32>(1.0));
  scan = tex_srgb2lin(gamma);

  // Ponderation perceptuelle, la meme que partout ailleurs dans le depot.
  let lum = dot(scan, vec3<f32>(0.2126, 0.7152, 0.0722));
  scan = mix(scan, vec3<f32>(lum), desaturation);
  scan = mix(scan, vec3<f32>(1.0) - scan, inversion);

  // LE SCAN BRUT DANS LA BOITE, l'entree telle quelle dehors. Le mode de fusion
  // du calque et son opacite font le melange, dans le wrapper de shaderCompose
  // — d'ou l'absence de parametres "Melange" et "Force" ici, qui les
  // doubleraient.
  //
  // A couverture 1 — le cas de la boite par defaut, plein cadre — mix rend
  // exactement scan : WGSL definit mix(x, y, a) par x*(1-a) + y*a, donc x*0 + y,
  // sans arrondi. C'est ce qui laisse les references existantes intactes.
  return vec4<f32>(mix(color.rgb, scan, couverture), color.a);
}
`,
};

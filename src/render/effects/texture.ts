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
  ],
  /**
   * QUATRE SECTIONS, ET AUCUNE CONDITION — le seul effet du registre qui n'en
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
   * CE QUE LE DÉCOUPAGE SÉPARE, ce sont quatre questions qui ne se posent pas
   * au même moment : QUELLE matière (*Scan*), posée COMMENT sur le cadre
   * (*Placement*), retournée ou décolorée (*Matière*), et étirée jusqu'où
   * (*Niveaux*). Les deux dernières se ressemblent et ne font pas la même
   * chose : *Matière* transforme le scan, *Niveaux* le rend simplement VISIBLE
   * — sans lui, les scans réellement disponibles ont une étendue moyenne de dix
   * niveaux sur 255 et ne se voient pas (mesure du 2026-08-05, voir le
   * commentaire de `contraste`).
   *
   * *Placement* est la seule `grille` : quatre libellés courts, deux fois moins
   * de lignes. Les trois autres sont des `liste` — *Scan* rend un sélecteur à
   * vignettes et non un curseur, et les deux dernières portent des libellés que
   * deux colonnes tronqueraient.
   */
  sections: [
    { id: "scan", label: "Scan", layout: "liste", params: ["rang"] },
    { id: "placement", label: "Placement", layout: "grille", params: ["echelle", "rotation", "decalageX", "decalageY"] },
    { id: "matiere", label: "Matière", layout: "liste", params: ["inversion", "desaturation"] },
    { id: "niveaux", label: "Niveaux", layout: "liste", params: ["contraste", "pivot"] },
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

  // Rotation autour du CENTRE du cadre, puis echelle, puis decalage. Tourner
  // autour de l'origine ferait fuir la texture hors du cadre des que l'angle
  // bouge, ce qui rendrait le curseur inutilisable.
  let centre = uv - vec2<f32>(0.5);
  let s = sin(angle);
  let c = cos(angle);
  let tourne = vec2<f32>(centre.x * c - centre.y * s, centre.x * s + centre.y * c);
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

  // LE SCAN BRUT, et rien d'autre. Le mode de fusion du calque et son opacite
  // font le melange, dans le wrapper de shaderCompose — d'ou l'absence de
  // parametres "Melange" et "Force" ici, qui les doubleraient.
  return vec4<f32>(scan, color.a);
}
`,
};

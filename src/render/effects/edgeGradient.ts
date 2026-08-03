/**
 * Gradient de contour de Scharr, aujourd'hui lu par un seul effet : `outlines`,
 * qui l'a vu naître, dans ses deux modes d'encre et ses trois modes de
 * détection.
 *
 * IL A EU DEUX AUTRES LECTEURS, et les deux sont revenus dans `outlines` le
 * 2026-08-03 : `coloredEdges` (ADR-0013), devenu son paramètre `inkMode`, et
 * `echoOutlines` (ADR-0015), devenu son troisième mode de détection.
 * L'extraction avait donc bien vu juste — elle avait seulement vu des effets là
 * où il y avait des paramètres.
 *
 * ⚠️ LE MODULE RESTE, malgré son unique lecteur. Le supprimer en le réinlinant
 * remettrait le noyau, ses poids et la preuve d'isotropie ci-dessous dans un
 * fichier de 500 lignes, où le prochain effet à bords ne les trouverait pas.
 * C'est la copie qui coûte, pas le fichier.
 *
 * Extrait d'`outlines.ts` le 2026-08-01, pour la raison exacte qui avait fait
 * extraire `blurChain.ts` de `glow`/`halation` et `hsl.ts` de `duotone` : deux
 * copies auraient dérivé, et l'écart se serait lu comme un défaut d'optique
 * alors qu'il n'aurait été qu'un défaut de copier-coller. Ici la conséquence
 * serait pire qu'ailleurs — deux effets de contour posés sur la même photo
 * dessineraient des bords À DES ENDROITS DIFFÉRENTS, ce qui ressemble à un
 * choix esthétique et n'est qu'une divergence de constante.
 *
 * L'extraction a été rendue prouvable AVANT d'être faite : `outlines` n'avait
 * aucun verrou de pixels, alors que sa sortie dépend d'un noyau 3x3 sur huit
 * taps, d'une mesure de chromaticité et d'un plancher `fwidth`. Le scénario de
 * rendu `effet-outlines` a donc été posé d'abord, sur le code d'avant.
 *
 * POURQUOI SCHARR ET PAS SOBEL. Les poids de Sobel (1,2,1) donnent une réponse
 * qui dépend de l'ORIENTATION du contour : une diagonale sort ~10 % plus faible
 * qu'une verticale, donc un même seuil ouvre les traits horizontaux et ferme
 * les obliques — le dessin se troue par endroits sans raison lisible. Les poids
 * de Scharr (3,10,3) sont l'optimum de symétrie de rotation pour un noyau 3x3.
 *
 * POURQUOI UN TAP PORTE TROIS MESURES. Un gradient de luminance est aveugle aux
 * contours ISOLUMINANTS — une fleur rouge sur des feuilles vertes, un vêtement
 * sur une peau. Chaque tap porte donc le ton perceptuel (x) ET la chromaticité
 * (y, z), et les deux gradients se calculent sur les MÊMES huit lectures : la
 * sensibilité couleur ne coûte que de l'ALU, pas de la bande passante.
 *
 * COÛT : 8 taps. Le tap central n'apparaît pas — ses poids sont nuls dans les
 * deux noyaux de Scharr, l'échantillonner serait une lecture payée pour être
 * multipliée par zéro.
 *
 * Requiert `UV_SPACE_WGSL` (mirrorUv), `LINEAR_TO_SRGB_WGSL` et
 * `INPUT_DRIVER_WGSL` (input_source).
 */
export const EDGE_GRADIENT_WGSL = `
struct EdgeGradient {
  gx: vec3<f32>,
  gy: vec3<f32>,
  /**
   * Moyenne du PILOTE sur les huit taps — donc le pilote passé au filtre
   * passe-bas que l'écartement des taps réalise déjà.
   *
   * Ajoutée le 2026-08-03 pour le mode « Seuil de forme » d'\`outlines\`, et elle
   * corrige un défaut que la référence de ce mode a montré à sa PREMIÈRE
   * exécution : sur un bord franc, tracer l'isoligne du pilote BRUT donne un
   * trait d'un pixel quelle que soit l'épaisseur demandée. La raison est
   * structurelle — un échelon n'a aucune valeur intermédiaire, donc l'isoligne
   * n'a nulle part où s'épaissir, et \`fwidth\` y explose au lieu de mesurer une
   * pente. Le trait sortait pointillé à 3 px demandés.
   *
   * Le pilote lissé, lui, a une rampe large de l'écartement des taps : son
   * isoligne s'épaissit comme on le lui demande, et sa pente est exactement ce
   * que mesure \`toneMag\`. Même remède que le liseré d'un pixel de \`gooeyMerge\`
   * — donner une LARGEUR à ce qui n'en avait pas.
   *
   * Gratuite : les huit lectures sont déjà faites.
   */
  moyenne: f32,
};

// Un tap porte les DEUX mesures : le ton perceptuel (x) et la chromaticité
// (y,z). Les deux gradients de Scharr se calculent donc sur les mêmes huit
// lectures — la sensibilité couleur ne coûte que de l'ALU, pas de la bande
// passante.
fn edgeTap(uv: vec2<f32>, off: vec2<f32>, source: f32) -> vec3<f32> {
  // mirrorUv : les taps de bord sortent du cadre. Sans repli, le sampler
  // clamp-to-edge rend le même texel des deux côtés du bord, ce qui annule le
  // gradient : le dessin s'ouvrirait pile sur le périmètre de l'image.
  let s = textureSample(srcTexture, srcSampler, mirrorUv(uv + off));
  let c = s.rgb;
  // input_source : ton PERCEPTUEL (défaut) ou couverture alpha.
  let driver = input_source(s, source);
  // Chromaticité : écarts de canaux normalisés par l'énergie totale du pixel,
  // donc invariants à l'exposition — deux verts d'éclairement différent ont la
  // même chromaticité et ne lèvent aucun contour.
  let energy = c.r + c.g + c.b + 0.0001;
  // En entrée ALPHA, les deux composantes chromatiques sont mises à zéro : le
  // champ suivi est une couverture, et lui adjoindre les contours de couleur de
  // l'image ferait lever le trait sur un champ qu'on ne suit pas.
  let chroma = select(
    vec2<f32>((c.r - c.g) / energy, (c.g - c.b) / energy),
    vec2<f32>(0.0),
    source > 0.5
  );
  return vec3<f32>(driver, chroma.x, chroma.y);
}

// Scharr 3x3 (poids 3/10/3), appliqué simultanément aux trois mesures portées
// par chaque tap. Le tap central n'apparaît pas : ses poids sont nuls dans les
// deux noyaux. \`h\` est le demi-écartement des taps, EN UV.
fn edge_scharr(uv: vec2<f32>, h: vec2<f32>, source: f32) -> EdgeGradient {
  let tl = edgeTap(uv, vec2<f32>(-h.x, -h.y), source);
  let tc = edgeTap(uv, vec2<f32>( 0.0, -h.y), source);
  let tr = edgeTap(uv, vec2<f32>( h.x, -h.y), source);
  let ml = edgeTap(uv, vec2<f32>(-h.x,  0.0), source);
  let mr = edgeTap(uv, vec2<f32>( h.x,  0.0), source);
  let bl = edgeTap(uv, vec2<f32>(-h.x,  h.y), source);
  let bc = edgeTap(uv, vec2<f32>( 0.0,  h.y), source);
  let br = edgeTap(uv, vec2<f32>( h.x,  h.y), source);

  var g: EdgeGradient;
  g.gx = (tr * 3.0 + mr * 10.0 + br * 3.0) - (tl * 3.0 + ml * 10.0 + bl * 3.0);
  g.gy = (bl * 3.0 + bc * 10.0 + br * 3.0) - (tl * 3.0 + tc * 10.0 + tr * 3.0);
  // Moyenne NON PONDEREE des huit taps : c'est un passe-bas, pas un noyau
  // directionnel, et le pondérer par les poids de Scharr en ferait un flou
  // anisotrope — exactement ce que ces poids sont là pour éviter ailleurs.
  g.moyenne = (tl.x + tc.x + tr.x + ml.x + mr.x + bl.x + bc.x + br.x) * 0.125;
  return g;
}
`;

/** Écartement des taps, EN UV, à partir d'une épaisseur en PIXELS.
 *
 *  ISOTROPIE : le décalage est exprimé en pixels puis divisé par les dimensions
 *  de la texture, canal par canal — le tap tombe donc à la même distance
 *  physique sur les deux axes par construction. Passer EN PLUS par
 *  `aspectScale` serait une DOUBLE correction, qui rendrait l'écartement
 *  anisotrope au lieu de le corriger. */
export const EDGE_SPACING_WGSL = `
fn edge_spacing(thickness: f32) -> vec2<f32> {
  return vec2<f32>(max(thickness, 0.25)) / vec2<f32>(textureDimensions(srcTexture));
}
`;

/** Normalisation du noyau : réponse de Scharr à une rampe unité sur un
 *  écartement de tap. Une magnitude divisée par ce nombre se lit donc
 *  directement comme « écart de ton perceptuel sur l'épaisseur du trait », et un
 *  seuil garde le même sens quand on change l'épaisseur. */
export const SCHARR_NORM = 32;

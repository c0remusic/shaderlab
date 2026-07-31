import type { EffectModule } from "./types";
import { HASH_WGSL } from "./hash";
import { UV_SPACE_WGSL } from "./uvSpace";

/**
 * Slice shift — tranche l'image en bandes et décale chacune, du léger décrochage
 * au glitch franc.
 *
 * LA VERSION NAÏVE, et pourquoi elle rend « filtre Photoshop 2005 » : bandes
 * d'épaisseur constante, décalage aléatoire par bande, coordonnée qui repart de
 * l'autre bord. Quatre pannes, toutes visibles à l'œil, toutes corrigées ici :
 *
 * 1. **Des bandes toutes de la même épaisseur font un PEIGNE.** L'œil trouve la
 *    période en une seconde et l'image se lit comme un store vénitien, pas comme
 *    un accident. « Irrégularité » fait fusionner une bande sur N avec sa
 *    voisine : les épaisseurs deviennent 1x, 2x, 3x sans aucune période. La
 *    fusion se fait par ADOPTION de l'identité du voisin (une bande prend
 *    l'index de celle d'avant), jamais en déformant l'axe avant de le
 *    quantifier — un axe déformé n'est plus monotone et les bandes se
 *    chevaucheraient, ce qui produit des doublons de contenu.
 *
 * 2. **Le rebouclage par l'autre bord recolle deux bords étrangers.** Une bande
 *    décalée montrerait le bord droit de l'image collé à son bord gauche : une
 *    couture verticale franche, à chaque bande, toujours au même endroit —
 *    exactement le motif régulier qu'on essayait d'éviter. `mirrorUv` replie par
 *    réflexion : la bande sort sur du contenu continu.
 *
 * 3. **Décaler TOUTES les bandes détruit l'image.** Il ne reste rien à
 *    reconnaître, donc rien à casser — un glitch n'est lisible que contre ce qui
 *    tient encore. « Densité » fixe la part de bandes réellement décalées ; le
 *    reste de l'image est intact au pixel près.
 *
 * 4. **Un décalage identique sur les trois canaux ne ressemble à aucun défaut
 *    réel.** La signature d'une image corrompue, c'est la désynchronisation des
 *    canaux. « Écart des canaux » décale le rouge et le bleu un peu plus et un
 *    peu moins que le vert, proportionnellement au décalage de la bande — donc
 *    nul là où la bande ne bouge pas, jamais un liseré coloré posé sur une zone
 *    immobile.
 *
 * COÛT : 3 taps (un par canal), une seule passe, aucune texture intermédiaire.
 *
 * `seed` rend le tirage REPRODUCTIBLE : deux ouvertures du même document
 * donnent les mêmes tranches. C'est le même choix que `grain`, et ce qui permet
 * à `npm run test:render` de verrouiller cet effet au pixel.
 */
export const sliceShift: EffectModule = {
  id: "sliceShift",
  name: "Slice shift",
  params: [
    { name: "angle", label: "Direction des tranches", unit: "degrees", min: 0, max: 360, default: 0, step: 1, hint: "0° = bandes horizontales décalées horizontalement" },
    { name: "sliceSize", label: "Épaisseur des tranches", unit: "pixels", min: 2, max: 400, default: 48, step: 1, hint: "Épaisseur de base, en pixels pleine résolution — l'irrégularité en fusionne certaines" },
    { name: "displace", label: "Décalage", unit: "percent", min: 0, max: 0.5, default: 0.08, step: 0.005, hint: "Amplitude maximale du glissement d'une tranche, en fraction de l'image" },
    { name: "density", label: "Densité", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "Part des tranches réellement décalées — le reste de l'image reste intact, et c'est ce qui rend le décrochage lisible" },
    { name: "irregular", label: "Irrégularité", unit: "percent", min: 0, max: 1, default: 0.45, step: 0.01, hint: "Probabilité qu'une tranche fusionne avec sa voisine — sans elle, les bandes forment un peigne à période visible" },
    { name: "chromaSplit", label: "Écart des canaux", unit: "percent", min: 0, max: 1, default: 0.3, step: 0.01, hint: "Désynchronise rouge et bleu par rapport au vert, proportionnellement au décalage de la tranche" },
    { name: "seed", label: "Graine", unit: "none", min: 0, max: 1000, default: 0, step: 1, hint: "Change le tirage sans changer les réglages. Reproductible : la même graine redonne les mêmes tranches" },
  ],
  wgsl: `
${UV_SPACE_WGSL}${HASH_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let angle = radians(params[0]);
  let sliceSize = max(params[1], 1.0);
  let displace = params[2];
  let density = clamp(params[3], 0.0, 1.0);
  let irregular = clamp(params[4], 0.0, 1.0);
  let chromaSplit = clamp(params[5], 0.0, 1.0);
  let seed = params[6];

  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  let q = (uv - vec2<f32>(0.5)) * ar;
  // \`along\` est la direction DANS laquelle une tranche glisse ; \`normal\` est
  // l'axe le long duquel on les compte. Les deux sortent du même angle, donc
  // tourner l'effet fait tourner bandes ET glissement ensemble — les découpler
  // donnerait un cisaillement, pas des tranches.
  let along = vec2<f32>(cos(angle), sin(angle));
  let normal = vec2<f32>(-along.y, along.x);

  // Index de tranche. \`q\` est en pixels/sqrt(W*H) : on remultiplie pour que
  // « épaisseur » soit lisible en PIXELS pleine résolution, comme le rayon du
  // pinceau et l'épaisseur de trait d'\`outlines\`.
  let n = dot(q, normal) * sqrt(dims.x * dims.y);
  let band = floor(n / sliceSize);

  // ADOPTION : une bande sur \`irregular\` prend l'identité de sa voisine
  // précédente, donc son décalage. Deux bandes adjacentes qui partagent une
  // identité forment une bande deux fois plus épaisse, trois en forment une
  // triple. Monotone par construction : aucun chevauchement possible, donc
  // aucun contenu dupliqué.
  var id = band;
  if (hash(vec2<f32>(band, seed + 101.0)) < irregular) {
    id = band - 1.0;
  }

  // Deux tirages INDÉPENDANTS sur la même identité : l'un décide si la tranche
  // bouge, l'autre de combien. Un seul tirage ferait que les tranches actives
  // seraient exactement celles au grand décalage — la densité deviendrait un
  // second réglage d'amplitude au lieu d'un réglage de proportion.
  // \`moved\` et non \`active\` : \`active\` est un mot RÉSERVÉ de WGSL et le
  // compilateur le refuse comme nom de variable. Attrapé par
  // \`npm run test:gpu-shaders\`, jamais par tsc.
  let moved = step(1.0 - density, hash(vec2<f32>(id, seed + 17.0)));
  let amount = (hash(vec2<f32>(id, seed)) * 2.0 - 1.0) * displace * moved;

  // Écart des canaux PROPORTIONNEL au décalage : nul sur une tranche immobile,
  // donc jamais de frange colorée sur une zone que l'utilisateur voit comme
  // intacte.
  let split = amount * chromaSplit * 0.18;
  let baseUv = (q + along * amount) / ar + vec2<f32>(0.5);
  let deltaUv = (along * split) / ar;

  let r = textureSample(srcTexture, srcSampler, mirrorUv(baseUv + deltaUv)).r;
  let g = textureSample(srcTexture, srcSampler, mirrorUv(baseUv)).g;
  let b = textureSample(srcTexture, srcSampler, mirrorUv(baseUv - deltaUv)).b;

  return vec4<f32>(r, g, b, color.a);
}
`,
};

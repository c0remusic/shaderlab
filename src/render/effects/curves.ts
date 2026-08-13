import type { CurveChannelControl, EffectModule, EffectParam, EffectSection } from "./types";
import { evaluateMonotoneCurve, type CurvePoint } from "../../ui/curveControl";
import {
  LINEAR_TO_SRGB_VEC3_WGSL,
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

const LUMA = [0.2126, 0.7152, 0.0722] as const;
const CHANNEL_IDS = ["master", "red", "green", "blue"] as const;
const CHANNEL_LABELS = ["Maître", "Rouge", "Vert", "Bleu"] as const;

function channelParamNames(id: string) {
  return {
    startY: `${id}StartY`,
    points: [0, 1, 2].map((slot) => ({ x: `${id}Point${slot + 1}X`, y: `${id}Point${slot + 1}Y` })) as CurveChannelControl["points"],
    endY: `${id}EndY`,
  };
}

function channelParams(id: string): EffectParam[] {
  const names = channelParamNames(id);
  const ordinate = (name: string, defaultValue: number): EffectParam => ({
    name, label: name, unit: "percent", min: 0, max: 1, default: defaultValue, step: 0.001,
  });
  return [
    ordinate(names.startY, 0),
    ...names.points.flatMap((point, index) => [
      { name: point.x, label: point.x, unit: "percent" as const, min: -1, max: 1, default: -1, step: 0.001 },
      ordinate(point.y, (index + 1) / 4),
    ]),
    ordinate(names.endY, 1),
  ];
}

const curveChannels: CurveChannelControl[] = CHANNEL_IDS.map((id, index) => ({
  id,
  label: CHANNEL_LABELS[index],
  ...channelParamNames(id),
}));

/**
 * Les quatre canaux en SECTIONS — un groupe nommé par canal, et pas une liste de
 * trente-deux entrées.
 *
 * D'OÙ ÇA VIENT. `curves` est le plus chargé du registre (37 paramètres), et 32
 * sortent du `flatMap(channelParams)` ci-dessus : quatre fois les mêmes huit
 * abscisses et ordonnées, dont le libellé EST leur propre nom (`redPoint2X`).
 * Ces libellés n'ont jamais été écrits pour être lus — personne ne règle une
 * courbe au curseur, c'est `CurveControl` qui les pilote, et `ParamPanel` les
 * exclut déjà de sa liste (`controlledParams`). L'exclusion les rendait
 * invisibles sans jamais dire à QUOI ils appartenaient ; la section le nomme.
 *
 * ⚠️ CE QUI RELIE UNE SECTION À SON CANAL, CE SONT LES PARAMÈTRES QU'ELLE CITE,
 * pas son identifiant. Les deux sortent de `channelParamNames`, donc renommer un
 * paramètre déplace la figure et la section ensemble. Un rapprochement par id se
 * délierait en silence : une figure privée de ses paramètres ne lève rien, elle
 * s'affiche vide.
 */
const channelSections: EffectSection[] = CHANNEL_IDS.map((id, index) => {
  const names = channelParamNames(id);
  return {
    id: `canal-${id}`,
    label: CHANNEL_LABELS[index],
    // Ordre interne = celui de `channelParams`, donc celui de `params[]` : une
    // section déplace un bloc entier, elle ne le retraverse pas.
    params: [names.startY, ...names.points.flatMap((point) => [point.x, point.y]), names.endY],
    layout: "figure",
  };
});

function channelPoints(params: readonly number[], offset: number): CurvePoint[] {
  const points: CurvePoint[] = [{ x: 0, y: params[offset] }];
  for (let slot = 0; slot < 3; slot += 1) {
    const x = params[offset + 1 + slot * 2];
    if (x < 0) break;
    points.push({ x, y: params[offset + 2 + slot * 2] });
  }
  points.push({ x: 1, y: params[offset + 7] });
  return points;
}

function isIdentityChannel(params: readonly number[], offset: number): boolean {
  return params[offset] === 0 && params[offset + 7] === 1 &&
    params[offset + 1] < 0 && params[offset + 3] < 0 && params[offset + 5] < 0;
}

/** Twin CPU du shader, utilisé pour verrouiller identité, bornes et parité. */
export function curvesSpec(rgb: readonly [number, number, number], params: readonly number[]): [number, number, number] {
  const source: [number, number, number] = [rgb[0], rgb[1], rgb[2]];
  if ([0, 8, 16, 24].every((offset) => isIdentityChannel(params, offset))) return source;
  const luma = source[0] * LUMA[0] + source[1] * LUMA[1] + source[2] * LUMA[2];
  const mappedLuma = evaluateMonotoneCurve(channelPoints(params, 0), luma);
  const scale = luma > 1e-6 ? mappedLuma / luma : 0;
  const master = luma > 1e-6 ? source.map((value) => value * scale) : [mappedLuma, mappedLuma, mappedLuma];
  const corrected: [number, number, number] = [0, 1, 2].map((channel) =>
    evaluateMonotoneCurve(channelPoints(params, 8 + channel * 8), master[channel])) as [number, number, number];
  const tone = Math.min(1, Math.max(0, luma));
  const smoothstep = (a: number, b: number, x: number) => {
    if (b <= a) return x >= b ? 1 : 0;
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const range = smoothstep(params[32], params[33], tone) * (1 - smoothstep(params[34], params[35], tone));
  const amount = Math.min(1, Math.max(0, params[36])) * range;
  return source.map((value, channel) => Math.min(1, Math.max(0, value + (corrected[channel] - value) * amount))) as [number, number, number];
}

const WGSL_CURVE = `
fn curve_is_identity(base: u32) -> bool {
  return params[base] == 0.0 && params[base + 7u] == 1.0 &&
    params[base + 1u] < 0.0 && params[base + 3u] < 0.0 && params[base + 5u] < 0.0;
}
fn curves_smoothstep_safe(edge0: f32, edge1: f32, x: f32) -> f32 {
  if (edge1 <= edge0) { return select(0.0, 1.0, x >= edge1); }
  let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
fn curve_eval(xIn: f32, base: u32) -> f32 {
  var xs = array<f32, 5>(0.0, 1.0, 1.0, 1.0, 1.0);
  var ys = array<f32, 5>(params[base], params[base + 7u], params[base + 7u], params[base + 7u], params[base + 7u]);
  var count = 2u;
  for (var slot = 0u; slot < 3u; slot += 1u) {
    let px = params[base + 1u + slot * 2u];
    if (px < 0.0) { break; }
    xs[count - 1u] = px;
    ys[count - 1u] = params[base + 2u + slot * 2u];
    xs[count] = 1.0;
    ys[count] = params[base + 7u];
    count += 1u;
  }
  var slopes = array<f32, 4>();
  var tangents = array<f32, 5>();
  for (var i = 0u; i + 1u < count; i += 1u) { slopes[i] = (ys[i + 1u] - ys[i]) / (xs[i + 1u] - xs[i]); }
  tangents[0] = slopes[0];
  tangents[count - 1u] = slopes[count - 2u];
  for (var i = 1u; i + 1u < count; i += 1u) {
    tangents[i] = select(0.5 * (slopes[i - 1u] + slopes[i]), 0.0, slopes[i - 1u] * slopes[i] <= 0.0);
  }
  for (var i = 0u; i + 1u < count; i += 1u) {
    if (slopes[i] == 0.0) { tangents[i] = 0.0; tangents[i + 1u] = 0.0; }
    else {
      let alpha = tangents[i] / slopes[i];
      let beta = tangents[i + 1u] / slopes[i];
      let magnitude = alpha * alpha + beta * beta;
      if (magnitude > 9.0) {
        let factor = 3.0 / sqrt(magnitude);
        tangents[i] = factor * alpha * slopes[i];
        tangents[i + 1u] = factor * beta * slopes[i];
      }
    }
  }
  let x = clamp(xIn, 0.0, 1.0);
  var segment = count - 2u;
  for (var i = 0u; i + 1u < count; i += 1u) { if (x <= xs[i + 1u]) { segment = i; break; } }
  let width = xs[segment + 1u] - xs[segment];
  let t = (x - xs[segment]) / width;
  let t2 = t * t;
  let t3 = t2 * t;
  return clamp((2.0*t3-3.0*t2+1.0)*ys[segment] + (t3-2.0*t2+t)*width*tangents[segment] + (-2.0*t3+3.0*t2)*ys[segment+1u] + (t3-t2)*width*tangents[segment+1u], 0.0, 1.0);
}`;

export const curves: EffectModule = {
  id: "curves",
  name: "Courbes",
  params: [
    ...CHANNEL_IDS.flatMap(channelParams),
    { name: "shadowsMin", label: "Début des ombres", unit: "percent", min: 0, max: 1, default: 0, step: 0.001 },
    { name: "shadowsMax", label: "Fin des ombres", unit: "percent", min: 0, max: 1, default: 0, step: 0.001 },
    { name: "highlightsMin", label: "Début des hautes lumières", unit: "percent", min: 0, max: 1, default: 1, step: 0.001 },
    { name: "highlightsMax", label: "Fin des hautes lumières", unit: "percent", min: 0, max: 1, default: 1, step: 0.001 },
    { name: "mix", label: "Mélange", unit: "percent", min: 0, max: 1, default: 1, step: 0.01 },
  ],
  sections: [
    ...channelSections,
    {
      // `figure` et non `paire`, alors que ce sont bien deux couples de bornes.
      // Le gabarit décrit ce qui S'AFFICHE, et ces quatre-là ne s'affichent
      // jamais en curseurs : `TonalRangeControl` les pilote, et `ParamPanel` les
      // exclut de sa liste au même titre que les points de courbe. Déclarer
      // `paire` promettrait deux lignes de curseurs que rien ne rendrait.
      id: "plage-tonale",
      label: "Plage tonale",
      params: ["shadowsMin", "shadowsMax", "highlightsMin", "highlightsMax"],
      layout: "figure",
    },
    // `mix` n'est cité par AUCUNE section, et c'est délibéré : il dose le
    // résultat des quatre canaux à la fois, plus la plage tonale. Le ranger sous
    // l'un d'eux le ferait passer pour son réglage ; lui inventer une section à
    // lui seul rendrait un titre pour une ligne. Un paramètre non cité reste
    // rendu à sa place, qui est ici la bonne — en dernier, sous tout ce qu'il dose.
  ],
  curveControls: [{ id: "curves", label: "Courbes", channels: curveChannels }],
  tonalRangeControl: { shadowsMin: "shadowsMin", shadowsMax: "shadowsMax", highlightsMin: "highlightsMin", highlightsMax: "highlightsMax" },
  wgsl: `${WGSL_CURVE}
${LINEAR_TO_SRGB_WGSL}
${LINEAR_TO_SRGB_VEC3_WGSL}
${SRGB_TO_LINEAR_WGSL}
${SRGB_TO_LINEAR_VEC3_WGSL}
const CURVES_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

// LA COURBE TRAVAILLE EN PERCU, PAS EN LUMIERE LINEAIRE. Arbitrage d'Antoine
// du 2026-08-13, devant l'image : lever le point noir donnait un gris moyen
// delave au lieu d'un noir leve, et faisait diverger la chromaticite dans les
// ombres (pixels rouges et violets sur les bords de la silhouette).
//
// Mesure qui l'a montre : point noir a 25 %, la moyenne de l'image passait a
// 146/255 et l'ecart-type s'effondrait de 60,7 a 19,1 — toute separation des
// ombres perdue. A 1 % seulement, la moyenne montait deja de 43,6 a 60,2. Un
// pour cent de lumiere lineaire est un grand pas perceptuel : c'est la
// non-linearite elle-meme qui rendait le curseur inutilisable.
//
// Ce n'est PAS une entorse a la regle du depot ("jamais de gamma manuel sur un
// echantillon d'image"). C'est la seconde exception, deja ecrite dans
// srgbTransfer.ts : un aller-retour FERME. On encode, on applique la courbe,
// on redecode dans la meme expression ; ce qui sort est lineaire, comme ce qui
// est entre, et le mix final se fait bien en lineaire. Cinq effets suivaient
// deja cette regle (texture, dither, halftone, hatching, gradientMap,
// channelMixer) ; curves etait le seul a ne pas la suivre, alors qu'il est le
// plus tonal de tous.
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  if (curve_is_identity(0u) && curve_is_identity(8u) && curve_is_identity(16u) && curve_is_identity(24u)) { return color; }
  let percu = linear_to_srgb3(color.rgb);
  let luma = dot(percu, CURVES_LUMA);
  let mappedLuma = curve_eval(luma, 0u);
  // GAIN BORNE, sinon le canal maitre fabrique des pixels colores dans les
  // ombres. Le maitre preserve la teinte en multipliant la couleur par
  // mappedLuma/luma ; quand luma tend vers zero ce facteur explose (luma
  // 0,001 et sortie 0,25 donnent un gain de 250), et il multiplie le BRUIT
  // chromatique du JPEG avec le reste. C'est ce qui semait des points rouges
  // et violets sur les bords de la silhouette — vu par Antoine le 2026-08-13,
  // attenue mais PAS supprime par le passage en percu.
  //
  // Au-dela du plafond, on complete vers le gris neutre au lieu d'etirer la
  // chroma : la luma visee est atteinte exactement dans les deux cas, et sous
  // le plafond le resultat est identique au bit pres a l'ancienne formule
  // (manque vaut alors zero). Ce n'est donc pas un nouveau rendu, c'est le
  // meme sans sa singularite.
  let gain = min(mappedLuma / max(luma, 0.000001), 4.0);
  let teinte = percu * gain;
  let manque = mappedLuma - dot(teinte, CURVES_LUMA);
  let master = select(vec3<f32>(mappedLuma), teinte + vec3<f32>(manque), luma > 0.000001);
  let corrected = srgb_to_linear3(vec3<f32>(curve_eval(master.r, 8u), curve_eval(master.g, 16u), curve_eval(master.b, 24u)));
  // La plage tonale se compare a la luma PERCUE elle aussi : ses quatre bornes
  // sont des valeurs posees au curseur, donc perceptuelles. Les comparer a une
  // luma lineaire les decalait — le meme defaut que la courbe, sur les memes
  // reglages.
  let range = curves_smoothstep_safe(params[32], params[33], luma) * (1.0 - curves_smoothstep_safe(params[34], params[35], luma));
  let amount = clamp(params[36], 0.0, 1.0) * range;
  return vec4<f32>(clamp(mix(color.rgb, corrected, amount), vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}`,
};

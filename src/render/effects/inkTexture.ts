import type { EffectParam } from "./types";

/**
 * ENCRE RÉELLE — l'irrégularité d'un tirage imprimé, appliquée aux effets qui
 * TRACENT UNE MARQUE : `halftone`, `dither`, `hatching`.
 *
 * D'OÙ ÇA VIENT. Arbitrage d'Antoine le 2026-08-05 : « l'encre ne mérite pas
 * plutôt son propre effet ? ». La réponse est non, et le critère est celui que
 * le dépôt applique depuis ADR-0014 — **une famille se rouvre pour un MÉCANISME
 * différent, jamais pour une nuance**. Les trois effets font tous la même
 * chose : calculer une marque à partir du ton. L'encre réelle ne change pas ce
 * calcul, elle change COMMENT la marque est tracée. C'est une propriété de la
 * marque, partagée par les trois.
 *
 * Un effet « encre » seul n'aurait rien à encrer ; trois modes séparés
 * recopieraient la même logique trois fois. D'où ce module TRANSVERSAL, sur le
 * patron exact de `blendSpace` et `inputMode` (§6bis du cahier du 2026-08-01 :
 * « des contrôles récurrents, à traiter comme une famille plutôt qu'effet par
 * effet »).
 *
 * ⚠️ **CE QU'ON PRÉLÈVE EST L'IRRÉGULARITÉ, PAS LA DENSITÉ.** Un scan d'encre a
 * une luminance moyenne quelconque — 139 à 223 sur les huit premiers scans
 * mesurés. Ajouter sa VALEUR à un seuil le déplacerait donc en bloc : la trame
 * deviendrait uniformément plus claire ou plus sombre, ce qui est un réglage
 * d'exposition déguisé et non de l'encre. On prélève un HAUT DE BANDE — le
 * centre moins la moyenne de quatre voisins — dont la moyenne est nulle par
 * construction. Le seuil se FROISSE sans se déplacer, quel que soit le scan
 * choisi. C'est aussi ce qui évite un troisième paramètre (« point médian »)
 * qu'il aurait fallu régler à la main sur chaque texture.
 *
 * ⚠️ **LA TEXTURE ARRIVE PAR LE BINDING 7**, donc l'effet adoptant doit déclarer
 * `libraryTexture` (`EffectModule`), et il ne peut PAS avoir de passes internes
 * — `validateEffect` le refuse, parce que `FramePipelineExecutor` ne résout ce
 * binding que pour la passe finale. Les trois effets visés sont mono-passe,
 * vérifié.
 *
 * ⚠️ **L'ORDRE DES PARAMÈTRES EST UN CONTRAT.** Un effet qui adopte l'encre
 * ajoute ces paramètres à la FIN de sa liste — leur index est persisté dans les
 * presets. Et `force` vaut 0 par défaut : un effet qui adopte ce module rend
 * exactement les mêmes pixels qu'avant, ce que le verrou de rendu vérifie.
 */

/** Rayon du prélèvement, en TEXELS du scan. Deux et non un : à un texel, le
 *  haut de bande n'est que du bruit d'échantillonnage bilinéaire, et il moirerait
 *  dès que le scan est plus fin que la trame. Deux texels attrapent la bavure
 *  d'un bord d'encre, qui est ce qu'on cherche. */
export const INK_TAP_RADIUS = 2;

/** Rang de la texture d'encre dans le catalogue de la bibliothèque. Même
 *  contrat que le `rang` de l'effet `texture` : c'est une POSITION dans la
 *  liste triée du dossier, pas une identité. */
export function inkTextureRankParam(overrides: Partial<EffectParam> = {}): EffectParam {
  return {
    name: "encreRang",
    label: "Encre",
    min: 0,
    max: 63,
    default: 0,
    step: 1,
    unit: "none",
    hint: "Scan d'encre dont l'irrégularité vient froisser la marque.",
    ...overrides,
  };
}

/** Dosage. **Zéro par défaut, et ce n'est pas négociable** : c'est ce qui rend
 *  l'adoption de ce module invisible au verrou de pixels des effets existants. */
export function inkAmountParam(overrides: Partial<EffectParam> = {}): EffectParam {
  return {
    name: "encreForce",
    label: "Bavure d'encre",
    min: 0,
    max: 1,
    default: 0,
    step: 0.01,
    unit: "percent",
    hint: "0 = marque parfaite. Au-delà, le bord de la marque prend l'irrégularité du scan.",
    ...overrides,
  };
}

/** Échelle du scan d'encre, en fraction du cadre. Séparée de l'échelle de la
 *  trame : l'irrégularité d'un papier n'a aucune raison de suivre la taille des
 *  points, et les faire varier ensemble produirait un motif qui « colle » à la
 *  trame au lieu de la salir. */
export function inkScaleParam(overrides: Partial<EffectParam> = {}): EffectParam {
  return {
    name: "encreEchelle",
    label: "Échelle d'encre",
    min: 0.05,
    max: 2,
    default: 0.5,
    step: 0.01,
    unit: "none",
    hint: "Taille du scan d'encre sur le cadre. Il se répète au-delà.",
    ...overrides,
  };
}

/** Les trois paramètres, dans l'ordre où ils doivent être ajoutés — à la FIN de
 *  la liste de l'effet adoptant. */
export function inkTextureParams(): EffectParam[] {
  return [inkTextureRankParam(), inkAmountParam(), inkScaleParam()];
}

/**
 * Jumeau TS du prélèvement WGSL, pour que la propriété qui compte — **moyenne
 * nulle** — soit prouvée par un test plutôt qu'affirmée par un commentaire.
 *
 * `echantillon(u, v)` rend la luminance du scan aux coordonnées données ;
 * `pas` est la taille d'un texel dans le même espace.
 */
export function inkIrregularite(
  echantillon: (u: number, v: number) => number,
  u: number,
  v: number,
  pasU: number,
  pasV: number,
  rayon: number = INK_TAP_RADIUS,
): number {
  const du = pasU * rayon;
  const dv = pasV * rayon;
  const voisins =
    (echantillon(u - du, v) + echantillon(u + du, v) + echantillon(u, v - dv) + echantillon(u, v + dv)) / 4;
  return echantillon(u, v) - voisins;
}

/**
 * Helpers WGSL. À injecter dans le corps d'un effet AVANT son `fs_main`.
 *
 * `ink_irregularite` suppose `libraryTexture` (binding 7) et `srcSampler`
 * disponibles — donc que l'effet déclare `libraryTexture`. Rend 0 quand la
 * texture de repli 1×1 est liée (décodage en cours), ce qui laisse la marque
 * intacte au lieu de la froisser d'une valeur arbitraire pendant une frame.
 */
export const INK_TEXTURE_WGSL = `
fn ink_irregularite(uv: vec2<f32>, echelle: f32) -> f32 {
  let dims = textureDimensions(libraryTexture);
  // Repli 1x1 : pas de scan encore decode. Zero, donc marque inchangee.
  if (dims.x <= 1u || dims.y <= 1u) {
    return 0.0;
  }
  let e = max(echelle, 0.01);
  let tuv = fract(uv / e);
  let w = vec3<f32>(0.2126, 0.7152, 0.0722);
  // Le pas est en TEXELS du scan, pas en pixels du cadre : c'est la finesse du
  // scan qui decide de ce qu'est une bavure, pas la definition de la photo.
  let pas = vec2<f32>(f32(${INK_TAP_RADIUS}) / f32(dims.x), f32(${INK_TAP_RADIUS}) / f32(dims.y));
  let centre = dot(textureSample(libraryTexture, srcSampler, tuv).rgb, w);
  let voisins = (
    dot(textureSample(libraryTexture, srcSampler, tuv - vec2<f32>(pas.x, 0.0)).rgb, w) +
    dot(textureSample(libraryTexture, srcSampler, tuv + vec2<f32>(pas.x, 0.0)).rgb, w) +
    dot(textureSample(libraryTexture, srcSampler, tuv - vec2<f32>(0.0, pas.y)).rgb, w) +
    dot(textureSample(libraryTexture, srcSampler, tuv + vec2<f32>(0.0, pas.y)).rgb, w)
  ) * 0.25;
  // HAUT DE BANDE : moyenne nulle par construction. Un scan clair ou sombre ne
  // deplace donc PAS le seuil, il ne fait que le froisser.
  return centre - voisins;
}

/** Froisse un seuil (ou une couverture) avec l'irregularite du scan d'encre.
 *  \`force\` a 0 rend la valeur INCHANGEE, au bit pres. */
fn ink_froisse(valeur: f32, uv: vec2<f32>, echelle: f32, force: f32) -> f32 {
  if (force <= 0.0) {
    return valeur;
  }
  return valeur + ink_irregularite(uv, echelle) * force;
}
`;

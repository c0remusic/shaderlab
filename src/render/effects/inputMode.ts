import type { EffectParam } from "./types";

/**
 * MODE D'ENTRÉE — quel champ scalaire de l'image un effet PILOTE lit, quand ce
 * champ n'est pas la couleur elle-même.
 *
 * D'OÙ ÇA VIENT. Cahier de références du 2026-08-01, §6bis, même phrase que
 * `blendSpace` : le mode d'entrée est un contrôle récurrent chez Figma et
 * absent partout chez nous. Figma l'expose sur `outlines` (Luma / Luma inversé
 * / Alpha) et sur `gooey merge` (Alpha ou Luminance).
 *
 * CE QUI A CHANGÉ CHEZ NOUS ENTRE-TEMPS, et qui rend « Alpha » possible.
 * L'en-tête de `gooeyMerge` affirme, depuis sa rédaction, qu'« une photo n'a
 * pas d'alpha à flouter, le portage naïf n'existe donc pas ». C'était vrai
 * quand la toile était toujours une photo opaque. Ça ne l'est plus depuis « le
 * fond devient un calque » (2026-07-28) : `shaderCompose` compose désormais un
 * alpha DROIT en source-over, et une toile de montage a de vraies régions
 * transparentes. Le mode Alpha n'est donc pas un emprunt à Figma — c'est le
 * gooey merge D'ORIGINE (flouter l'alpha, lui remettre du contraste) devenu
 * atteignable.
 *
 * POURQUOI LA LUMINANCE EST LUE SUR L'AXE PERCEPTUEL. `linear_to_srgb(luma)`,
 * pas `luma`. C'est le choix que `gooeyMerge` et `outlines` faisaient déjà
 * chacun de leur côté, pour la même raison écrite dans les deux fichiers : un
 * seuil ou un gradient posé sur la luminance LINÉAIRE est un réglage
 * d'exposition déguisé. Ce module ne fait que rassembler la formule ; au mode
 * 0, il rend exactement ce que ces deux effets calculaient avant lui.
 *
 * POURQUOI L'ALPHA N'EN PASSE PAS PAR LÀ. Un alpha n'est pas un ton, c'est une
 * COUVERTURE : il n'a pas de fonction de transfert à défaire, et lui appliquer
 * l'OETF sRGB tordrait une fraction de surface comme si c'était une luminosité.
 *
 * L'ORDRE DES CHOIX EST UN CONTRAT — l'index est persisté dans les presets et
 * lu tel quel par le shader. On ajoute à LA FIN, jamais au milieu.
 */
export const INPUT_MODE_CHOICES = ["Luminance", "Luminance inversée", "Alpha"] as const;

export const INPUT_MODE_LUMA = 0;
export const INPUT_MODE_LUMA_INVERTED = 1;
export const INPUT_MODE_ALPHA = 2;

/**
 * Vocabulaire d'`outlines` — et son histoire vaut d'être lue, parce qu'il a été
 * RESTREINT sur preuve puis ROUVERT sur une autre preuve, sans qu'aucune des
 * deux soit fausse.
 *
 * ÉTAT INITIAL (2026-08-01) : deux choix seulement, Luminance et Alpha.
 * `outlines` mesurait un gradient, et |∇(1−x)| = |∇x| — inverser la luminance
 * laisse la magnitude rigoureusement inchangée, donc le trait tracé aurait été
 * identique au pixel près. « Luminance inversée » y aurait été un contrôle
 * INERTE, exactement l'échec silencieux que ce dépôt proscrit (même raison qui a
 * fait retirer les quatre paramètres de teinte du glow plutôt que de les laisser
 * sans effet).
 *
 * ROUVERT LE 2026-08-03, quand `outlines` a gagné un second mode de DÉTECTION :
 * le seuil de forme, où le trait suit l'isoligne du pilote au niveau demandé.
 * La preuve d'origine ne couvre pas ce mode — elle porte sur un opérateur
 * DIFFÉRENTIEL, et celui-ci seuille.
 *
 * ⚠️ MAIS ELLE NE SUFFIT PAS NON PLUS À JUSTIFIER LE CONTRÔLE, et c'est le point
 * subtil. Sur un tracé de frontière seul, inverser revient à chercher l'isoligne
 * au niveau `1 − seuil` : le contrôle ne serait pas inerte, il serait REDONDANT
 * avec le curseur de seuil, ce qui n'est guère mieux. Ce qui le rend
 * véritablement porteur, c'est l'opération ASYMÉTRIQUE qui l'accompagne — le
 * remplissage de la forme. Déplacer le seuil déplace la frontière ; inverser le
 * pilote change QUEL CÔTÉ est peint, et aucun réglage du seuil ne le fait.
 *
 * C'est aussi la lecture correcte de la fiche Figma (« Inverse luma uses
 * darkness, for dark art or text on white ») : leur effet remplit et fait
 * rayonner une forme, donc chez eux l'inversion a toujours été porteuse.
 *
 * L'ORDRE EST UN CONTRAT : « Luminance inversée » est ajoutée EN FIN de liste et
 * non à sa place « logique » au milieu, parce que l'index est persisté dans les
 * presets — un calque réglé sur Alpha (1) serait devenu Luminance inversée.
 */
export const INPUT_SOURCE_CHOICES = ["Luminance", "Alpha", "Luminance inversée"] as const;

export const INPUT_SOURCE_LUMA = 0;
export const INPUT_SOURCE_ALPHA = 1;
export const INPUT_SOURCE_LUMA_INVERTED = 2;

/** Fabrique du paramètre à 3 choix. Bornes posées ici une fois — `validateEffect`
 *  exige `min: 0`, `step: 1`, `max === choices.length - 1`. */
export function inputModeParam(overrides: Partial<EffectParam> = {}): EffectParam {
  return {
    name: "inputMode",
    label: "Mode d'entrée",
    unit: "none",
    min: 0,
    max: INPUT_MODE_CHOICES.length - 1,
    default: INPUT_MODE_LUMA,
    step: 1,
    choices: [...INPUT_MODE_CHOICES],
    hint: "Quel champ de l'image pilote l'effet — la luminance, son inverse (les zones sombres prennent le rôle des claires), ou la couverture alpha de la toile",
    ...overrides,
  };
}

/** Fabrique du paramètre à 3 choix (voir `INPUT_SOURCE_CHOICES` : il en porte trois depuis l'ajout de « Luminance inversée » le 2026-08-03, que le JSDoc juste au-dessus raconte en vingt-cinq lignes — cette ligne-ci ne l'avait pas suivi). */
export function inputSourceParam(overrides: Partial<EffectParam> = {}): EffectParam {
  return {
    name: "inputSource",
    label: "Entrée",
    unit: "none",
    min: 0,
    max: INPUT_SOURCE_CHOICES.length - 1,
    default: INPUT_SOURCE_LUMA,
    step: 1,
    choices: [...INPUT_SOURCE_CHOICES],
    hint: "Sur quoi les contours sont cherchés — la luminance de l'image, la couverture alpha (la silhouette d'un élément de montage), ou la luminance inversée. Cette dernière est SANS OBJET en détection par crête de gradient, où inverser laisse la magnitude inchangée ; elle sert au seuil de forme, où elle décide quel côté est la forme",
    ...overrides,
  };
}

/** Poids de luminance BT.709, les mêmes que partout ailleurs dans `effects/`. */
export const INPUT_LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

/** Jumeau TS de `input_driver` — `color` est une couleur LINÉAIRE + alpha.
 *  Toute modification de la formule se fait des DEUX côtés. */
export function inputDriver(
  color: readonly [number, number, number, number],
  mode: number,
  linearToSrgb: (c: number) => number
): number {
  if (Math.round(mode) === INPUT_MODE_ALPHA) return color[3];
  const luma = linearToSrgb(
    INPUT_LUMA_WEIGHTS[0] * color[0] + INPUT_LUMA_WEIGHTS[1] * color[1] + INPUT_LUMA_WEIGHTS[2] * color[2]
  );
  return Math.round(mode) === INPUT_MODE_LUMA_INVERTED ? 1 - luma : luma;
}

/**
 * Jumeau WGSL. Requiert `LINEAR_TO_SRGB_WGSL`.
 *
 * `if` et non `select` : le mode vient d'un UNIFORME, donc le branchement est
 * uniforme sur toute la passe et une seule branche s'exécute réellement (même
 * raisonnement que `mix_in_space`, et inverse de celui de `gradientMap`, dont
 * la condition varie d'un pixel à l'autre).
 */
export const INPUT_DRIVER_WGSL = `
fn input_driver(color: vec4<f32>, mode: f32) -> f32 {
  // Un alpha est une COUVERTURE, pas un ton : aucune fonction de transfert à
  // lui défaire, contrairement à la luminance juste en dessous.
  if (i32(mode + 0.5) == ${INPUT_MODE_ALPHA}) {
    return color.a;
  }
  let luma = linear_to_srgb(dot(color.rgb, vec3<f32>(${INPUT_LUMA_WEIGHTS[0]}, ${INPUT_LUMA_WEIGHTS[1]}, ${INPUT_LUMA_WEIGHTS[2]})));
  if (i32(mode + 0.5) == ${INPUT_MODE_LUMA_INVERTED}) {
    return 1.0 - luma;
  }
  return luma;
}

// Vocabulaire d'\`outlines\` (\`INPUT_SOURCE_CHOICES\`) exprimé DANS celui de
// \`input_driver\`, plutôt que réimplémenté : une seule formule de luminance
// dans tout le dossier, et le décalage d'index est écrit là où on peut le lire.
//
// La table de correspondance N'EST PAS l'identité, et c'est voulu : « Luminance
// inversée » a été ajoutée en FIN de \`INPUT_SOURCE_CHOICES\` (index 2) pour ne
// pas déplacer Alpha, qui est persisté à l'index 1 dans les presets. Elle occupe
// donc ici la place 2 et vise la place 1 de \`INPUT_MODE_CHOICES\`.
//
//   INPUT_SOURCE 0 (Luminance)          -> INPUT_MODE 0
//   INPUT_SOURCE 1 (Alpha)              -> INPUT_MODE 2
//   INPUT_SOURCE 2 (Luminance inversée) -> INPUT_MODE 1
fn input_source(color: vec4<f32>, source: f32) -> f32 {
  let s = i32(source + 0.5);
  var mode = f32(${INPUT_MODE_LUMA});
  if (s == ${INPUT_SOURCE_ALPHA}) { mode = f32(${INPUT_MODE_ALPHA}); }
  if (s == ${INPUT_SOURCE_LUMA_INVERTED}) { mode = f32(${INPUT_MODE_LUMA_INVERTED}); }
  return input_driver(color, mode);
}
`;

import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

export const duotone: EffectModule = {
  id: "duotone",
  name: "Duotone",
  params: [
    { name: "shadowHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 350, step: 1, colorGroup: { key: "shadow", role: "hue", label: "Ombres" } },
    { name: "shadowSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.65, step: 0.01, colorGroup: { key: "shadow", role: "saturation", label: "Ombres" } },
    { name: "shadowLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.25, step: 0.01, colorGroup: { key: "shadow", role: "lightness", label: "Ombres" } },
    { name: "midtoneHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 30, step: 1, colorGroup: { key: "midtone", role: "hue", label: "Ton moyen" } },
    { name: "midtoneSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, colorGroup: { key: "midtone", role: "saturation", label: "Ton moyen" } },
    { name: "midtoneLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, colorGroup: { key: "midtone", role: "lightness", label: "Ton moyen" } },
    { name: "highlightHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 220, step: 1, colorGroup: { key: "highlight", role: "hue", label: "Hautes lumières" } },
    { name: "highlightSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, colorGroup: { key: "highlight", role: "saturation", label: "Hautes lumières" } },
    { name: "highlightLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, colorGroup: { key: "highlight", role: "lightness", label: "Hautes lumières" } },
    { name: "contrast", label: "Contraste (écrasement)", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, hint: "0 = dégradé doux entre les trois teintes, 1 = bascules dures (aplats nets)" },
    { name: "pivot", label: "Pivot (ton moyen)", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Position du ton moyen sur l'axe de luminosité — décale l'équilibre ombres/hautes lumières" },
  ],
  /**
   * SECTIONS — découpage THÉMATIQUE, et donc sans `appliesWhen`. Duotone ne
   * porte aucun mode exclusif : ses onze réglages sont vivants en permanence, il
   * n'y a pas de régime qui en commande d'autres. Ce qui se regroupe ici n'est
   * pas un mode, c'est la QUESTION posée.
   *
   * DEUX NATURES DE RÉGLAGE, qui ne se règlent pas au même moment. « De quelles
   * trois couleurs » est un choix d'encres : on l'arrête une fois, en regardant
   * les pastilles. « Où la photo bascule de l'une à l'autre » est un ajustement
   * qu'on reprend à chaque photo — `contrast` et `pivot` ne sont lus que pour
   * poser les deux bascules sur l'axe des tons (centres à `pivot - 0.3` et
   * `pivot + 0.3`, largeur pilotée par `contrast`) et ne touchent AUCUNE
   * couleur. Mélangés dans une liste plate, les deux se cherchent.
   *
   * UNE SECTION PAR ENCRE, plutôt qu'une seule section « Couleurs » : les trois
   * pastilles sont des blocs ATOMIQUES (trois rôles chacune, dont
   * `groupEffectParams` ne tire qu'un item), et l'ordre de `params[]` les donne
   * déjà dans l'ordre de l'axe tonal. Le titre nomme la PLACE sur l'axe, la
   * pastille montre la couleur qui s'y trouve — aucun item ne se déplace.
   *
   * ⚠️ « TON MOYEN » MANQUE AU PLAN, et c'est une omission de sa part. Task 5
   * ter annonce « Ombres · Hautes lumières · Tonalité » — le duotone classique à
   * deux encres, alors que celui-ci en a trois depuis le début. La ranger sous
   * « Tonalité » aurait mis une COULEUR sous un titre qui ne parle que de
   * placement, à côté de deux curseurs qui n'en produisent aucune.
   *
   * ⚠️ `paire` ICI N'A NI POINT NOIR NI POINT BLANC. Le plan écrit « paire sur
   * les points noir et blanc » ; duotone n'en a pas — il n'a pas de rampe à
   * borner, il a deux bascules à poser. `contrast` et `pivot` tiennent le rôle
   * STRUCTUREL que `blackPoint`/`whitePoint` tiennent dans `gradientMap` : deux
   * curseurs de même unité qui se lisent comme un seul réglage coupé en deux
   * — « où » et « à quel point c'est dur ». C'est ce régime-là que le gabarit
   * rend, pas une paire de noms.
   */
  sections: [
    { id: "ombres", label: "Ombres", layout: "liste", params: ["shadowHue", "shadowSaturation", "shadowLightness"] },
    { id: "ton-moyen", label: "Ton moyen", layout: "liste", params: ["midtoneHue", "midtoneSaturation", "midtoneLightness"] },
    { id: "hautes-lumieres", label: "Hautes lumières", layout: "liste", params: ["highlightHue", "highlightSaturation", "highlightLightness"] },
    { id: "tonalite", label: "Tonalité", layout: "paire", params: ["contrast", "pivot"] },
  ],
  wgsl: `
${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Les trois couleurs sortent du picker HSL en sRGB (valeurs PERCEPTUELLES,
  // exactement ce qu'affiche la pastille CSS du sélecteur). Elles étaient
  // écrites telles quelles dans une cible -srgb, qui les ré-encode une
  // seconde fois : un bordeaux à luminosité 0.25 ressortait ~2x trop clair,
  // en gris-rosé délavé, et la pastille ne pouvait pas coïncider avec le
  // canvas. On les décode vers le LINÉAIRE avant tout mélange — c'est la
  // COULEUR D'ENTRÉE qu'on convertit, jamais l'échantillon d'image.
  let shadowColor = srgb_to_linear3(hsl2rgb(params[0] / 360.0, params[1], params[2]));
  let midtoneColor = srgb_to_linear3(hsl2rgb(params[3] / 360.0, params[4], params[5]));
  let highlightColor = srgb_to_linear3(hsl2rgb(params[6] / 360.0, params[7], params[8]));
  let contrast = params[9];
  let pivot = params[10];
  // Luma en espace linéaire (le format de texture -srgb a déjà décodé le sRGB
  // à l'échantillonnage) — même convention que les autres effets du registry.
  let luma = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  // Les seuils se posent sur la luminance PERCEPTUELLE, pas linéaire. En
  // linéaire, pivot=0.5 plaçait la bascule des hautes lumières à luma 0.8,
  // soit ~0.91 en sRGB : quasi blanc, donc la 3e couleur était invisible sur
  // une photo normale, et le ton moyen mangeait toute l'image (bascule basse à
  // 0.2 linéaire = 0.48 sRGB, le gris moyen perceptuel). Constaté au
  // checkpoint 2026-07-26 : "hautes lumières ne change rien".
  let tone = linear_to_srgb(luma);
  // Deux bascules symétriques autour du pivot : ombres->ton moyen à
  // pivot-0.3, ton moyen->hautes lumières à pivot+0.3. contrast=0 -> bascules
  // larges et douces ; contrast=1 -> bascules quasi instantanées (aplats).
  let halfSpan = 0.15 * (1.0 - contrast);
  let center1 = pivot - 0.3;
  let center2 = pivot + 0.3;
  let t1 = smoothstep(center1 - halfSpan, center1 + max(halfSpan, 0.0001), tone);
  let t2 = smoothstep(center2 - halfSpan, center2 + max(halfSpan, 0.0001), tone);
  let lowMid = mix(shadowColor, midtoneColor, t1);
  let result = mix(lowMid, highlightColor, t2);
  return vec4<f32>(result, color.a);
}
`,
};

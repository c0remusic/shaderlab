import type { EffectModule } from "./types";
import { BAYER4_WGSL } from "./bayer";

export const posterize: EffectModule = {
  id: "posterize",
  name: "Posterize",
  params: [
    { name: "levels", label: "Paliers", unit: "none", min: 2, max: 16, default: 5, step: 1, hint: "Nombre de paliers de ton par canal — bas = aplats larges, haut = dégradé quasi continu" },
  ],
  wgsl: `
${BAYER4_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let levels = max(params[0], 2.0);
  let stepSize = 1.0 / (levels - 1.0);
  // Dither ordonné (Bayer 4x4, voir effects/bayer.ts) : décalage d'au plus un
  // demi-palier AVANT quantification — la frontière entre deux paliers devient
  // un motif fin au lieu d'une bande franche sur un dégradé doux. Le seuil ne
  // dépend que de la position en PIXELS, donc stable d'une frame à l'autre
  // (aucun scintillement), et son amplitude suit stepSize (un dither de
  // taille fixe serait invisible à 16 paliers et destructeur à 2).
  let px = vec2<u32>(uv * vec2<f32>(textureDimensions(srcTexture)));
  let dithered = color.rgb + vec3<f32>(bayerThreshold(px) * stepSize);
  let quantized = floor(dithered / stepSize + 0.5) * stepSize;
  // clamp : le demi-palier ajouté peut pousser un blanc pur au-dessus de 1.0
  // (et un noir pur sous 0.0) une fois quantifié.
  return vec4<f32>(clamp(quantized, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}
`,
};

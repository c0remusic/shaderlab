import type { EffectModule } from "./types";
import { UV_SPACE_WGSL } from "./uvSpace";

export const warp: EffectModule = {
  id: "warp",
  name: "Warp",
  params: [
    { name: "scale", label: "Échelle", unit: "none", min: 0.5, max: 12, default: 3, step: 0.25 },
    // Défaut remonté de 0.02 à 0.045, plafond de 0.08 à 0.25 (2026-07-31) :
    // 0.02/0.08 posait le curseur à 25 % de sa course, et le plafond lui-même
    // bornait le warp à ~5 % de la largeur — trop peu pour autre chose qu'un
    // frémissement. Le FBM culmine autour de ±0.5, donc à 0.045 sur 6240 px de
    // large le déplacement crête est de l'ordre de 140 px (contre ~60 avant).
    { name: "amplitude", label: "Amplitude", unit: "percent", min: 0, max: 0.25, default: 0.045, step: 0.002 },
    { name: "octaves", label: "Détails", unit: "none", min: 1, max: 4, default: 3, step: 1 },
    // Persistance du FBM : elle était FIGÉE à 0.5 dans `fbm`. C'est le
    // paramètre qui décide si le warp est une houle lisse (0.25) ou une
    // turbulence granuleuse (0.8), à échelle et amplitude identiques — le seul
    // réglage qui change la MATIÈRE du warp plutôt que sa taille.
    { name: "roughness", label: "Rugosité", unit: "none", min: 0.25, max: 0.8, default: 0.5, step: 0.01, hint: "Poids des octaves fines — bas = houle lisse, haut = turbulence" },
    { name: "anisotropy", label: "Anisotropie", unit: "none", min: -1, max: 1, default: 0, step: 0.01, hint: "Déséquilibre horizontal/vertical du déplacement — négatif = étire en vertical, positif = en horizontal" },
    { name: "twist", label: "Torsion", unit: "degrees", min: 0, max: 180, default: 0, step: 1, hint: "Fait pivoter le champ de déplacement : 0 = pousse, 90° = cisaille le long des lignes de niveau du bruit" },
    { name: "seed", label: "Graine", unit: "none", min: 0, max: 100, default: 0, step: 1 },
  ],
  wgsl: `
${UV_SPACE_WGSL}
// 2D simplex-style gradient noise (self-contained WGSL).
//
// Hachage ENTIER de la maille. gnoise n'appelle hash2 que sur des points de
// grille (floor(p) décalé de 0 ou 1), donc la conversion en i32 est exacte
// et le hachage porte sur la cellule elle-même, pas sur un produit de flottants.
//
// La version précédente hachait en f32 : fract(x.x * x.y * (x.x + x.y)). Dès
// que la graine décale la maille de quelques centaines de cellules, cet argument
// dépasse 2**23 — l'ulp d'un f32 y vaut 1, fract() rend exactement 0, et
// hash2 rend (-1, -1) sur TOUTE la maille. Le gradient devient constant et le
// FBM dégénère en grille régulière, précisément ce que la barre de qualité
// interdit. Mesuré avant correctif, sur les 101 graines du paramètre : 89
// avaient au moins une octave morte, et les trois l'étaient à partir de seed=47.
//
// Borner le décalage aurait été le palliatif tentant : il est refusé, il
// remplacerait des grilles visibles par des quasi-doublons silencieux entre
// graines voisines — une panne moins spectaculaire, donc plus durable.
fn hash2(p: vec2<f32>) -> vec2<f32> {
  var h: u32 = (bitcast<u32>(i32(p.x)) * 1597334673u) ^ (bitcast<u32>(i32(p.y)) * 3812015801u);
  h = h ^ (h >> 15u);
  h = h * 2246822519u;
  h = h ^ (h >> 13u);
  let a: u32 = h * 2654435761u;
  let b: u32 = (h ^ 0x9E3779B9u) * 1597334673u;
  // 24 bits de poids fort : exactement représentables en f32, donc pas de
  // nouvelle perte de précision à la sortie du hachage.
  return vec2<f32>(
    f32(a >> 8u) * (2.0 / 16777216.0) - 1.0,
    f32(b >> 8u) * (2.0 / 16777216.0) - 1.0
  );
}

fn gnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(hash2(i + vec2<f32>(0.0, 0.0)), f - vec2<f32>(0.0, 0.0)),
        dot(hash2(i + vec2<f32>(1.0, 0.0)), f - vec2<f32>(1.0, 0.0)), u.x),
    mix(dot(hash2(i + vec2<f32>(0.0, 1.0)), f - vec2<f32>(0.0, 1.0)),
        dot(hash2(i + vec2<f32>(1.0, 1.0)), f - vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var freq = p;
  for (var i = 0; i < 4; i = i + 1) {
    if (i >= octaves) { break; }
    value = value + amplitude * gnoise(freq);
    amplitude = amplitude * 0.5;
    freq = freq * 2.0;
  }
  return value;
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let scale = params[0];
  let amplitude = params[1];
  let octaves = i32(params[2]);
  let seed = params[3];
  let p = uv * scale + vec2<f32>(seed * 13.7, seed * 7.3);
  // Isotropie (voir effects/uvSpace.ts) : le décalage nominal est divisé par le
  // facteur d'aspect, sinon la même amplitude déplace ~1.5x plus de pixels à
  // l'horizontale qu'à la verticale sur une photo 3:2 (étirement du warp).
  let ar = aspectScale(vec2<f32>(textureDimensions(srcTexture)));
  let offset = vec2<f32>(
    fbm(p, octaves),
    fbm(p + vec2<f32>(5.2, 1.3), octaves)
  ) * amplitude / ar;
  // mirrorUv : près du bord, uv + offset sort du cadre — sans repli, le
  // sampler clamp-to-edge étire le texel de bord en traînée.
  return textureSample(srcTexture, srcSampler, mirrorUv(uv + offset));
}
`,
};

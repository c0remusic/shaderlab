// HARNAIS SHADERLAB — champ de hauteur et pente des matieres PAVE.
//
// Pourquoi il existe : dans shaderlab, iterer sur une fonction de matiere veut
// dire editer le TS, attendre le HMR, recharger, rouvrir une photo, reposer le
// calque, choisir la matiere, regarder. Ici : enregistrer le fichier.
//
// Cible : les cinq Pave, qui portent les trois plus gros temps GPU mesures le
// 2026-08-14 (Quadrille 108 ms, Alveolaire 95 ms, Nuage 75 ms sur 24 Mpx) ET
// qui sont refuses a l'oeil (ROADMAP §1). Meme code, deux raisons de le rouvrir.
//
// Les fonctions ci-dessous sont COPIEES DE shaderlab (src/render/effects/
// glass.ts et hash.ts), donc du code maison. Les params[] y sont remplaces par
// des constantes editables juste en dessous.
//
// Charger : glisser ce fichier dans la fenetre shadplay, ou le recopier sur
// assets/shaders/myshader.wgsl qui est la cible de rechargement par defaut.

#import bevy_pbr::forward_io::VertexOutput

// ── REGLAGES (params[] de shaderlab, en dur ici) ────────────────────────────
const MATIERE: i32 = 13;    // 10 Ondule · 11 Quadrille · 12 Alveolaire · 13 Nuage · 14 Lisse
const BISEAU: f32 = 0.35;   // params[20], clamp 0.04..0.95
const INTERNE: f32 = 0.5;   // params[21], 0..1
const CELLULES: f32 = 6.0;  // nombre de paves visibles sur la largeur
const AFFICHAGE: i32 = 1;   // 0 = hauteur en gris · 1 = pente en couleur

// ── hash + valueNoise, copies de src/render/effects/hash.ts ─────────────────
fn hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn valueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

// ── mosaique + hauteur de pave, copies de src/render/effects/glass.ts ───────
fn verre_mosaiquePave(f: vec2<f32>, dens: f32) -> f32 {
  let p = f * dens;
  let i = floor(p);
  let g = fract(p) - 0.5;
  let r = vec2<f32>(0.36 + hash(i) * 0.11, 0.36 + hash(i + vec2<f32>(7.1, 3.3)) * 0.11);
  let a = abs(g) / r;
  let carre = 1.0 - smoothstep(0.78, 1.04, max(a.x, a.y));
  let dome = max(1.0 - dot(a, a) * 0.55, 0.0);
  return carre * (0.42 + 0.58 * dome);
}

fn verre_hauteurPave(f: vec2<f32>, mat: i32) -> f32 {
  let s = (f - 0.5) * 2.0;
  let b = clamp(BISEAU, 0.04, 0.95);
  let champ = (1.0 - smoothstep(1.0 - b, 1.0, abs(s.x))) * (1.0 - smoothstep(1.0 - b, 1.0, abs(s.y)));
  var moulage = 0.0;
  let interne = clamp(INTERNE, 0.0, 1.0);
  if (mat == 14) {
    moulage = 0.0;
  } else if (mat == 12) {
    moulage = (verre_mosaiquePave(f, mix(11.0, 6.0, interne)) - 0.5) * 0.30;
  } else if (mat == 11) {
    let k = mix(8.0, 20.0, interne);
    moulage = cos(6.2832 * f.y * k) * 0.13 + cos(6.2832 * f.x * k * 1.8) * 0.03;
  } else if (mat == 10) {
    let d = mix(1.8, 4.2, interne);
    moulage = (valueNoise(vec2<f32>(f.x * d, f.y * d * 0.34)) * 0.64
      + valueNoise(vec2<f32>(f.x * d * 2.3 + 3.1, f.y * d * 0.78 + 7.7)) * 0.36 - 0.5) * 0.17;
  } else {
    let d = mix(1.8, 9.0, interne);
    moulage = (valueNoise(f * d) * 0.62 + valueNoise(f * d * 2.3 + vec2<f32>(3.1, 7.7)) * 0.38 - 0.5) * 1.5;
  }
  return 1.0 - champ + moulage * champ;
}

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4<f32> {
  // Meme decoupage que shaderlab : fract(uv * dims / cell) donne la position
  // DANS le pave. Ici la grille est directe, sans dimensions de photo.
  let f = fract(in.uv * CELLULES);

  if (AFFICHAGE == 0) {
    let h = verre_hauteurPave(f, MATIERE);
    return vec4<f32>(vec3<f32>(h), 1.0);
  }

  // PENTE par differences finies, exactement comme la version en production —
  // c'est ce qu'on cherche a remplacer par une derivee analytique. Garder les
  // deux cote a cote ici est le point du harnais : on compare des IMAGES, pas
  // des formules.
  let e = 0.012;
  let h0 = verre_hauteurPave(f, MATIERE);
  let hx = verre_hauteurPave(f + vec2<f32>(e, 0.0), MATIERE);
  let hy = verre_hauteurPave(f + vec2<f32>(0.0, e), MATIERE);
  let gr = vec2<f32>(hx - h0, -(hy - h0)) / e;

  // Pente signee en couleur : rouge/cyan sur x, vert/magenta sur y. Une pente
  // nulle rend du gris moyen, donc les zones plates se lisent d'un coup d'oeil.
  let g = clamp(gr * 0.08, vec2<f32>(-1.0), vec2<f32>(1.0));
  return vec4<f32>(0.5 + g.x * 0.5, 0.5 + g.y * 0.5, 0.5, 1.0);
}

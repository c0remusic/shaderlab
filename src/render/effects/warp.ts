import type { EffectModule } from "./types";
import { UV_SPACE_WGSL } from "./uvSpace";

/**
 * Types de distorsion. L'index EST la valeur du paramètre, et `Bruit fractal`
 * est en tête — donc à l'index 0, donc le défaut : tout ce que cet effet
 * rendait avant ce paramètre continue de le rendre à l'identique.
 *
 * D'OÙ VIENNENT LES HUIT AUTRES. Fiche Figma du shader `Warp`, lue le
 * 2026-08-01 : « Pick a distortion shape in Type first. It defines the whole
 * character of the effect. » Le cahier de références concluait au §4 « pas
 * d'écart de référence » — jugement porté contre des références FBM génériques,
 * jamais contre ce shader. L'intersection était en fait VIDE : leurs huit
 * formes sont des formules FERMÉES centrées sur un point, notre bruit n'en
 * atteint aucune, et aucune des huit n'atteint notre houle.
 *
 * ELLES COHABITENT DANS UN SEUL EFFET, sur décision d'Antoine, plutôt que dans
 * un effet séparé comme le précédent glow/halation l'aurait suggéré. Ce qui les
 * réunit tient : toutes déplacent l'échantillonnage, toutes partagent
 * l'amplitude, la torsion, l'anisotropie et le repli de bord.
 *
 * Leur fiche note « Reset Frequency and Amplitude when you switch Type, since
 * each formula responds differently ». C'est vrai ici aussi, et c'est pourquoi
 * `Échelle` ne veut pas dire la même chose partout : nombre de cycles pour les
 * formes PÉRIODIQUES (sinusoïde, ondulation, drapeau, compression), serrage de
 * la décroissance pour les formes CENTRÉES (torsion, bulle, pincement,
 * tourbillon).
 */
const WARP_TYPES = [
  "Bruit fractal",
  "Sinusoïde",
  "Torsion",
  "Bulle",
  "Pincement",
  "Ondulation",
  "Drapeau",
  "Compression",
  "Tourbillon",
] as const;
const WARP_NOISE = 0;

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
    { name: "type", label: "Type", unit: "none", min: 0, max: WARP_TYPES.length - 1, default: WARP_NOISE, step: 1, choices: [...WARP_TYPES], hint: "Bruit fractal : la houle organique, sans centre. Les huit autres sont des déformations CENTRÉES : Sinusoïde, Torsion, Bulle, Pincement, Ondulation, Drapeau, Compression, Tourbillon. Reprendre Échelle et Amplitude après un changement de type — chaque formule y répond autrement." },
    { name: "centerX", label: "Centre X", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Point d'où la déformation irradie. Sans objet en Bruit fractal, qui n'a pas de centre." },
    { name: "centerY", label: "Centre Y", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Voir Centre X." },
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

// PERSISTANCE PASSÉE EN ARGUMENT (2026-08-01). Elle était figée à 0.5 dans ce
// corps, alors qu'un paramètre « Rugosité » existait depuis \`5ffd6b3\` et
// prétendait la régler. Le commentaire de ce paramètre annonçait même la
// correction — au passé, comme si elle avait eu lieu.
//
// La somme des poids n'est PAS normalisée, à dessein : à persistance 0.5 la
// suite vaut 0.5, 0.25, 0.125… soit exactement ce que ce corps calculait avant,
// donc le défaut ne bouge pas d'un bit. Le revers est assumé et se lit dans le
// libellé : monter la rugosité augmente aussi le déplacement TOTAL, parce que
// c'est ce que fait une persistance dans un FBM — les octaves fines ne
// remplacent pas les grosses, elles s'y ajoutent.
fn fbm(p: vec2<f32>, octaves: i32, persistence: f32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var freq = p;
  for (var i = 0; i < 4; i = i + 1) {
    if (i >= octaves) { break; }
    value = value + amplitude * gnoise(freq);
    amplitude = amplitude * persistence;
    freq = freq * 2.0;
  }
  return value;
}

// LES HUIT DÉFORMATIONS ANALYTIQUES. \`q\` est l'écart au centre dans l'espace
// ISOTROPE, donc un cercle y est un cercle. Chaque formule rend un déplacement
// dans ce même espace ; le retour en UV et la division par l'aspect ont lieu
// une seule fois, chez l'appelant.
//
// CHAQUE FORME EST NORMALISÉE pour qu'une même amplitude donne un déplacement
// du même ordre partout. Sans ça, le curseur d'amplitude aurait une course
// utile différente par type — le genre de détail qui fait qu'un effet « ne
// marche pas » alors qu'il est seulement mal calibré.
//
// La décroissance des formes CENTRÉES est une gaussienne : elle décroît
// asymptotiquement au lieu d'être coupée à un rayon, donc aucune de ces
// déformations ne laisse de cercle visible à sa limite. Corollaire à ne pas
// confondre avec la propriété ci-dessus : elle ne s'ANNULE pas pour autant. À
// échelle 3, le facteur vaut encore ~0.23 dans les coins d'un cadre carré, qui
// se déforment donc visiblement. Serrer la décroissance se fait par l'échelle,
// pas par une borne — une borne rendrait le cercle que cette forme évite.
fn warp_analytic(q: vec2<f32>, kind: i32, freq: f32, amp: f32) -> vec2<f32> {
  let r = length(q);
  // Direction radiale, sûre au centre exact : à r=0 le déplacement radial est
  // nul de toute façon, donc la valeur du vecteur n'y importe pas.
  let dir = q / max(r, 0.0001);
  let decay = exp(-r * r * freq);

  if (kind == 1) {
    // SINUSOÏDE : ondulation croisée, chaque axe déplacé par l'autre. C'est le
    // « shaken cloth » de la référence, et le seul des huit qui n'ait pas
    // besoin du centre — il est inclus pour rester avec sa famille.
    return vec2<f32>(sin(q.y * freq * 6.0), sin(q.x * freq * 6.0)) * amp;
  }
  if (kind == 2) {
    // TORSION : rotation d'un angle qui décroît avec le rayon. Le déplacement
    // est la DIFFÉRENCE entre le point tourné et le point d'origine — écrire
    // directement la tangente donnerait une spirale qui s'ouvre au lieu de se
    // refermer.
    let a = amp * 12.0 * decay;
    let c2 = cos(a);
    let s2 = sin(a);
    return vec2<f32>(q.x * c2 - q.y * s2, q.x * s2 + q.y * c2) - q;
  }
  if (kind == 3) {
    // BULLE : poussée radiale vers l'extérieur, maximale près du centre.
    return dir * (amp * 2.0 * r * decay);
  }
  if (kind == 4) {
    // PINCEMENT : la même, vers l'intérieur.
    return dir * (-amp * 2.0 * r * decay);
  }
  if (kind == 5) {
    // ONDULATION : rides concentriques, comme une pierre dans l'eau. La
    // décroissance est ici volontairement plus lente (racine) — des rides qui
    // s'éteignent trop vite ne se lisent pas comme une onde.
    return dir * (amp * sin(r * freq * 12.0) * sqrt(decay));
  }
  if (kind == 6) {
    // DRAPEAU : bandes ondulant dans un seul axe, sans décroissance. Le centre
    // n'y sert que de phase.
    return vec2<f32>(0.0, sin(q.x * freq * 6.0) * amp);
  }
  if (kind == 7) {
    // COMPRESSION : accordéon. Le déplacement croît avec l'écart au centre le
    // long de l'axe comprimé, d'où les bandes qui s'étirent et se tassent.
    return vec2<f32>(0.0, q.y * sin(q.x * freq * 6.0) * amp * 4.0);
  }
  if (kind == 8) {
    // TOURBILLON : même geste que la torsion, décroissance plus serrée et
    // angle plus fort — la référence le décrit comme « tighter, more dramatic
    // pinwheel than Twist ».
    let a = amp * 26.0 * decay * decay;
    let c2 = cos(a);
    let s2 = sin(a);
    return vec2<f32>(q.x * c2 - q.y * s2, q.x * s2 + q.y * c2) - q;
  }
  return vec2<f32>(0.0);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let scale = params[0];
  let amplitude = params[1];
  let octaves = i32(params[2]);
  let roughness = clamp(params[3], 0.05, 0.95);
  let anisotropy = clamp(params[4], -1.0, 1.0);
  let twist = radians(params[5]);
  // params[6], et non params[3]. Ce shader lisait la GRAINE à l'index 3, qui
  // est celui de la rugosité : bouger « Rugosité » changeait le motif du bruit,
  // et le curseur « Graine » ne faisait rien du tout. Trois autres contrôles
  // étaient purement morts — anisotropie, torsion, et la graine elle-même.
  let seed = params[6];
  let kind = i32(params[7] + 0.5);
  let center = vec2<f32>(params[8], params[9]);
  let p = uv * scale + vec2<f32>(seed * 13.7, seed * 7.3);
  // Isotropie (voir effects/uvSpace.ts) : le décalage nominal est divisé par le
  // facteur d'aspect, sinon la même amplitude déplace ~1.5x plus de pixels à
  // l'horizontale qu'à la verticale sur une photo 3:2 (étirement du warp).
  let ar = aspectScale(vec2<f32>(textureDimensions(srcTexture)));
  // Branchement UNIFORME (le type vient du uniform) : une seule des deux
  // familles s'exécute réellement. Le bruit fractal reste l'index 0, donc le
  // défaut, donc l'existant.
  var raw = vec2<f32>(0.0);
  if (kind == ${WARP_NOISE}) {
    raw = vec2<f32>(
      fbm(p, octaves, roughness),
      fbm(p + vec2<f32>(5.2, 1.3), octaves, roughness)
    );
  } else {
    // Les formes analytiques travaillent dans l'espace isotrope, et leur
    // amplitude est déjà normalisée par \`warp_analytic\` — d'où la division
    // par l'amplitude commune, qui sera réappliquée juste en dessous avec la
    // torsion et l'anisotropie. Un chemin unique pour la suite, plutôt que deux
    // sorties à garder d'accord.
    let q = (uv - center) * ar;
    raw = warp_analytic(q, kind, scale, amplitude) / max(amplitude, 0.0001);
  }
  // TORSION : fait pivoter le VECTEUR de déplacement, pas le champ de bruit. À
  // 0 c'est l'identité (le rendu d'avant), à 90° le déplacement devient
  // perpendiculaire à ce qu'il était — la matière cisaille le long des lignes
  // de niveau du bruit au lieu de les traverser.
  let c = cos(twist);
  let s = sin(twist);
  raw = vec2<f32>(raw.x * c - raw.y * s, raw.x * s + raw.y * c);
  // ANISOTROPIE : déséquilibre les deux axes. À 0 le facteur vaut (1,1), donc
  // neutre ; à +1 tout le déplacement passe à l'horizontale, à -1 à la
  // verticale. Appliqué APRÈS la torsion, sinon les deux se combattraient.
  raw = raw * vec2<f32>(1.0 + anisotropy, 1.0 - anisotropy);
  let offset = raw * amplitude / ar;
  // mirrorUv : près du bord, uv + offset sort du cadre — sans repli, le
  // sampler clamp-to-edge étire le texel de bord en traînée.
  return textureSample(srcTexture, srcSampler, mirrorUv(uv + offset));
}
`,
};

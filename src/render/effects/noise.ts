import type { EffectModule } from "./types";
import { HASH_WGSL, VALUE_NOISE_WGSL } from "./hash";
import { UV_SPACE_WGSL } from "./uvSpace";

/**
 * NOISE — un champ de bruit fractal PROCÉDURAL, généré, pas lu dans une image.
 *
 * D'OÙ ÇA VIENT. Retour d'usage d'Antoine le 2026-08-21, une référence de carte
 * topographique en main : « l'effet est beau mais on ne retrouve pas cet effet
 * là » (à propos d'`isolines`). Le diagnostic au pixel a montré que sa référence
 * n'est PAS `isolines` sur une photo — une photo a des aplats, `isolines` n'y
 * trace des courbes que là où le relief est doux. Sa référence est `isolines`
 * sur un RELIEF CONTINU qui ondule partout : un champ de bruit fractal. Prouvé
 * en générant un tel champ hors de l'app et en l'important comme image ; ce
 * module rend ce détour inutile, et sert de source à tout ce qui lit un relief.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IL PRODUIT, IL NE TRAITE PAS — et il sort le champ GRIS, brut
 * ─────────────────────────────────────────────────────────────────────────
 * Comme `texture`, `lightLeak` et `aplat`, il ne lit pas un texel de ce qui est
 * en dessous : il écrit un champ. Et comme eux il ne le COLORE pas — `duotone`,
 * `gradientMap` le colorent par-dessus, `isolines` en tire ses courbes de
 * niveau, `displacementMap`/`warp` pourraient s'en servir de carte. Un mapping
 * de couleur ici doublerait ces effets ; un champ gris les nourrit tous.
 *
 * Défaut `normal` à 1 (donc il écrase) : c'est un GÉNÉRATEUR de base, comme
 * `aplat` pose une couleur unie. On l'empile puis on écrête un effet dessus.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA QUALITÉ TIENT EN UN MOT : DOMAIN WARPING
 * ─────────────────────────────────────────────────────────────────────────
 * Un fBm nu (somme d'octaves) donne un bruit régulier, reconnaissable et un peu
 * mort — le « filtre 2005 » de la génération de texture. La technique qui le
 * rend organique et fluide, celle qui fait le relief d'une vraie carte, est de
 * DÉPLACER les coordonnées par un second champ de bruit avant d'échantillonner
 * le premier (Inigo Quilez, « domain warping », domaine public). `warp` à 0 rend
 * le fBm nu ; au-delà, le champ se met à couler. C'est l'upgrade qualité, pas un
 * ornement — sans lui, `isolines` dessus retomberait sur des courbes trop sages.
 *
 * ⚠️ **L'ORDRE DES PARAMÈTRES EST GELÉ.** Leur index est persisté dans les
 * presets ; on ajoute à la FIN, jamais au milieu. Pareil pour les `choices` de
 * `Motif` : une entrée s'ajoute à la fin de la liste.
 *
 * COÛT : ALU pur, aucune lecture de texture. Le warp coûte trois évaluations du
 * fBm au lieu d'une (le déplacement en x, en y, puis le champ déplacé).
 */
export const noise: EffectModule = {
  id: "noise",
  name: "Bruit fractal",
  params: [
    { name: "echelle", label: "Échelle", unit: "none", min: 1, max: 40, default: 6, step: 0.5, hint: "Taille des motifs : petit = quelques grandes ondulations, grand = un relief serré" },
    { name: "octaves", label: "Détail", unit: "none", min: 1, max: 8, default: 6, step: 1, hint: "Nombre d'échelles superposées. Chacune est deux fois plus fine que la précédente — plus il y en a, plus le relief porte de fins détails" },
    { name: "roughness", label: "Rugosité", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Poids des échelles fines face aux grandes. Bas = doux et vallonné, haut = rêche et détaillé" },
    // Le cœur de la qualité — voir l'en-tête. 0 = fBm nu ; au-delà, le champ coule.
    { name: "warp", label: "Ondulation", unit: "none", min: 0, max: 2, default: 0.35, step: 0.01, hint: "Déforme le champ par lui-même : à 0 le bruit est régulier, au-delà il devient fluide et organique, comme le relief d'une carte" },
    { name: "contraste", label: "Contraste", unit: "none", min: 0.2, max: 4, default: 1, step: 0.05, hint: "Étire ou tasse la dynamique autour du gris moyen, sans éclaircir ni assombrir l'ensemble" },
    { name: "type", label: "Motif", choices: ["Nuageux", "Crêtes", "Bulles"], min: 0, max: 2, default: 0, step: 1, hint: "Nuageux = fBm doux ; Crêtes = arêtes vives (montagnes) ; Bulles = bosses arrondies" },
    { name: "graine", label: "Graine", unit: "none", min: 0, max: 64, default: 0, step: 1, hint: "Change le tirage du champ sans rien changer d'autre" },
  ],
  /**
   * TROIS SECTIONS, AUCUNE CONDITION. Les sept paramètres servent toujours, quel
   * que soit le motif : `type` change la FORME de chaque octave, il ne rend aucun
   * autre curseur sans objet (un `appliesWhen` viserait de toute façon un
   * paramètre à `choices`, ce qu'il est, mais il n'y a rien à masquer).
   *
   * Le découpage suit les trois questions : de quoi est fait le relief (*Relief*),
   * quelle forme d'ensemble il prend (*Forme*), et quel tirage (*Aléa*).
   */
  sections: [
    { id: "relief", label: "Relief", layout: "liste", params: ["echelle", "octaves", "roughness", "type"] },
    { id: "forme", label: "Forme", layout: "liste", params: ["warp", "contraste"] },
    { id: "alea", label: "Aléa", layout: "liste", params: ["graine"] },
  ],
  wgsl: `
${HASH_WGSL}${VALUE_NOISE_WGSL}${UV_SPACE_WGSL}

// fBm : somme d'octaves de value-noise, chaque octave deux fois plus fine et
// d'un poids multiplie par la rugosite. La variante transforme CHAQUE octave
// avant la somme, pas le total : c'est ce qui donne aux cretes et aux bulles
// leur grain a toutes les echelles, et non une simple remise en forme du total.
//
// Octaves DYNAMIQUE par un break : la boucle est bornee a huit (le max du
// curseur) pour que le WGSL reste une chaine fixe, et sort des que le compte
// demande est atteint. Une octave non parcourue ne coute rien.
fn noise_fbm(p0: vec2<f32>, octaves: f32, gain: f32, variante: f32) -> f32 {
  var p = p0;
  var somme = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  for (var i = 0; i < 8; i = i + 1) {
    if (f32(i) >= octaves) { break; }
    var n = valueNoise(p);
    if (variante > 1.5) {
      // Bulles (billow) : |2n-1|, des bosses arrondies qui se touchent.
      n = abs(2.0 * n - 1.0);
    } else if (variante > 0.5) {
      // Cretes (ridged) : 1 - |2n-1|, des aretes vives, un relief de montagnes.
      n = 1.0 - abs(2.0 * n - 1.0);
    }
    somme = somme + amp * n;
    norm = norm + amp;
    amp = amp * gain;
    p = p * 2.0;
  }
  return somme / max(norm, 0.0001);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let echelle = max(params[0], 0.1);
  let octaves = clamp(params[1], 1.0, 8.0);
  let gain = clamp(params[2], 0.0, 1.0);
  let warp = max(params[3], 0.0);
  let contraste = max(params[4], 0.05);
  let variante = params[5];
  let graine = params[6];

  // ESPACE ISOTROPE : sans quoi le champ s'etirerait sur une photo non carree,
  // et une cellule ronde deviendrait ovale. Meme correctif que lightLeak/glass.
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  // La graine deplace le champ dans un plan tres eloigne : deux graines voisines
  // tirent des motifs sans parente, la meme graine rend exactement le meme champ.
  let base = uv * ar * echelle + vec2<f32>(graine * 19.7, graine * 7.3);

  // DOMAIN WARPING : deplacer les coordonnees par un second champ avant
  // d'echantillonner le premier. C'est la difference entre un bruit regulier et
  // le relief fluide d'une carte. A warp = 0 le deplacement est nul et l'on
  // retombe exactement sur le fBm nu.
  let q = vec2<f32>(
    noise_fbm(base, octaves, gain, variante),
    noise_fbm(base + vec2<f32>(5.2, 1.3), octaves, gain, variante),
  );
  let v0 = noise_fbm(base + warp * q, octaves, gain, variante);

  // CONTRASTE autour du gris moyen : etire ou tasse la dynamique sans deplacer
  // le point median, donc sans eclaircir ni assombrir l'ensemble.
  let v = clamp((v0 - 0.5) * contraste + 0.5, 0.0, 1.0);

  // RELIEF GRIS, brut : l'effet PRODUIT un champ, il ne le colore pas. On garde
  // l'alpha de l'entree pour que le masque du calque agisse comme sur tout autre.
  return vec4<f32>(v, v, v, color.a);
}
`,
};

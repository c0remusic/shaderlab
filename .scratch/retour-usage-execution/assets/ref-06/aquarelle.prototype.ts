import type { EffectModule } from "./types";
import { HASH_WGSL, VALUE_NOISE_WGSL } from "./hash";
import { UV_SPACE_WGSL } from "./uvSpace";
import { DOWNSAMPLE_WGSL, upsampleWgsl } from "./blurChain";

/**
 * PROTOTYPE JETABLE v5 « LA BAVE EST LOCALE AUX FRONTIERES » — aquarelle
 * (ticket 06, planche 6).
 *
 * NE PAS COMMITTER TEL QUEL. Ce fichier existe pour rendre une PLANCHE de
 * variantes qu'Antoine pointe ; le design se fige APRES le pointage. Cf.
 * `.scratch/retour-usage-execution/issues/06-concevoir-encre-procedurale.md`.
 *
 * POURQUOI v5. La planche 5 a montré que la première image qui ressemble à une
 * PEINTURE est le LAVIS SEUL (Kuwahara à bords gardés) ; dès que la bave
 * s'ajoute en GLOBAL (pyramide à 1/32, mélange partout), tout redevient un flou
 * et les fibres le rendent poilu. Dans une aquarelle réelle la bave est LOCALE :
 * deux lavis voisins s'échangent leur couleur sur une bande étroite à leur
 * frontière, l'intérieur d'un lavis reste plat. Changements de v4 -> v5 :
 *
 *   1. CARTE DE FRONTIERES E, ∈ [0,1], 1 près d'une frontière entre deux lavis,
 *      0 à l'intérieur, dilatée sur `bleedWidth` (% de la largeur). Elle est
 *      calculée DANS la composite à partir de la version diffusée (`prevPass`)
 *      par un anneau de taps au rayon `bleedWidth` : la texture diffusée porte
 *      elle-même l'information de frontière (un intérieur plat rend une
 *      différence de couleur nulle, une frontière rend une différence non
 *      nulle). Voir DECISION TRANSPORT ci-dessous — pourquoi pas de passe de
 *      dilatation dédiée ni d'empaquetage dans l'alpha.
 *
 *   2. BAVE LOCALE. La pyramide de diffusion est ramenée à 1/8 (au lieu de
 *      1/32). Dans la composite : out = mix(lavis, diffusée, wetness * E *
 *      plages) en absorbance. L'intérieur (E = 0) reste le lavis NET intact ;
 *      seule la frontière fond vers la version diffusée. Le champ de plages
 *      mouillées (`wetness` par seuil) ne fait plus que MODULER E.
 *
 *   3. FIBRES SEULEMENT AUX FRONTIERES. Le décalage d'UV de chaque passe de
 *      fibres est multiplié par une estimation LOCALE de frontière (gradient de
 *      sa propre entrée), donc l'intérieur d'un lavis ne bouge pas. Amplitude
 *      par défaut réduite (~0,15 % de la largeur).
 *
 *   4. FRONT inchangé (gradient de densité de la version bavée), donc
 *      naturellement à ces frontières. PAPIER inchangé.
 *
 * DECISION TRANSPORT de E jusqu'à la composite. La chaîne de passes internes est
 * strictement LINEAIRE : chaque passe ne lit que `srcTexture` (la sortie de la
 * précédente), et `blurChain.ts` (partagé, non modifiable ici) écrit toujours
 * alpha = 1. Empaqueter E dans l'alpha à travers la pyramide est donc perdu, et
 * une passe de dilatation dédiée produirait une DEUXIEME texture qu'aucune passe
 * ne peut fusionner avec la diffusée (pas de branche dans une chaîne linéaire).
 * Le brief laissait le choix « E dans l'alpha OU recalcul plein cadre » ; j'ai
 * pris une TROISIEME voie, plus simple et sans coût de passe : E est un anneau
 * de taps sur la texture DIFFUSEE, calculé dans la composite. La composite a
 * déjà les deux seules textures de la chaîne (source via `color`, bout de chaîne
 * via `prevPass`) — le lavis NET est recalculé en Kuwahara plein cadre comme le
 * faisait déjà v4 pour son côté sec, et E se lit sur la diffusée à coût de
 * simples samples bilinéaires.
 *
 * DECISION SEC (côté hors-bave de la composite, ce que montre le lavis seul). Le
 * sec RECALCULE le Kuwahara à PLEINE RESOLUTION au MEME rayon natif que le lavis
 * (pas plus petit), parce que la colonne « lavis seul » doit MONTRER le lavis à
 * la bonne échelle. Le Kuwahara PRESERVE les bords, donc « rester net » est
 * tenu. Le lavis à 0,25 ne sert QUE d'entrée à la bave.
 *
 * ZIPPER DU KUWAHARA 4x4. Le sous-agent de la planche 5 signalait un « zipper »
 * directionnel à grand rayon (secteurs carrés alignés sur la grille de pixels).
 * LAISSE tel quel en v5 : la colonne « lavis seul » DOIT rester ≈ à la planche 5
 * (référence de non-régression du lavis), et toute correction bon marché
 * (secteurs tournés, pondération radiale) déplacerait ce rendu de référence ;
 * un vrai anti-zipper (8 secteurs, pondération de Kyprianidis) double le nombre
 * de taps, déjà 64 par pixel dans la composite. Reporté, pas ignoré.
 *
 * CHAINE DE PASSES, chaque étage activé par `EffectPass.enabled` sur son curseur
 * (à 0 la passe SAUTE ; une passe sautée laisse la précédente passer telle
 * quelle, effectPassRunner.ts:250) :
 *
 *   0.   LAVIS (`wash`), scale 0.25. Kuwahara 4 secteurs à ~washRadius % de la
 *        largeur. Feed de la bave. Enabled wash>0.
 *   1-5. BAVE : pyramide de diffusion (down 0.5, 0.25, 0.125 ; up 0.25, 0.5) sur
 *        la sortie du lavis. `spread` pilote l'écartement des taps de remontée.
 *        Enabled wetness>0.
 *   6-8. FIBRES : 3 passes d'advection à scale 0.5 le long d'un flux HF relatif,
 *        amplitude courte, MULTIPLIEE par une frontière locale. Enabled fibers>0.
 *   composite (scale 1). Lit `color` (source) et `prevPass` (bout de chaîne) :
 *     - SEC (E = 0) = Kuwahara(source) PLEINE RESOLUTION mélangé par `wash`.
 *     - MOUILLE (E > 0) = mélange vers `prevPass` (lavis bavé + fibré).
 *     - E = carte de frontières (anneau sur la diffusée, rayon `bleedWidth`).
 *     - PLAGES : seuil d'un champ fbm ; ne fait que moduler E.
 *     - Blend en ABSORBANCE (moyenne géométrique en linéaire) : préserve les
 *       noirs.
 *     - FRONT DE PIGMENT : gradient de densité de `prevPass`, dentelé par HF.
 *     - PAPIER : réduction de densité en absorbance, en dernier.
 *
 * ESPACE COULEUR : la chaîne est sRGB par le FORMAT, donc textureSample rend déjà
 * du LINEAIRE (srcTexture et prevPass sont au format -srgb). Toute la diffusion et
 * les mélanges se font en linéaire sans aucun gamma manuel, décision verrouillée
 * du projet. Tous les clamps sont dans le shader.
 */

// Bruits, espace UV et helpers partages, injectes dans chaque module WGSL (chaque
// passe compile a part : aucun symbole n'est partage entre modules).
const AQ_COMMON_WGSL = `
${HASH_WGSL}
${VALUE_NOISE_WGSL}
${UV_SPACE_WGSL}

fn aqLuma(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// FBM du value noise partage, normalise par la somme des amplitudes pour rester
// dans [0,1] quel que soit le nombre d'octaves. Cap de 5 octaves en dur.
fn aq_fbm(p: vec2<f32>, oct: i32) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var f = p;
  var norm = 0.0;
  for (var i = 0; i < 5; i = i + 1) {
    if (i >= oct) { break; }
    v = v + a * valueNoise(f);
    norm = norm + a;
    a = a * 0.5;
    f = f * 2.0;
  }
  return v / max(norm, 1e-4);
}
`;

// KUWAHARA generalise a 4 secteurs, AQ_TAPS x AQ_TAPS taps par secteur. Un secteur
// = un quadrant ; on accumule moyenne RGB et variance de LUMINANCE, et le secteur
// le plus homogene (variance basse) domine : bords gardes, interieur aplati. Ce
// n'est PAS un flou. Le rayon est exprime en TEXELS de `dims` (donc RELATIF au
// scale de la passe) : a 0.25 un rayon r texels couvre 4r px natifs, a 1 il en
// couvre r. L'appelant passe washRadius % * dims.x -> le rayon natif est le meme
// aux deux resolutions.
const AQ_KUWAHARA_WGSL = `
const AQ_TAPS: i32 = 4;

fn aqSector(uv: vec2<f32>, step: vec2<f32>, sgn: vec2<f32>) -> vec4<f32> {
  var m = vec3<f32>(0.0);
  var lsum = 0.0;
  var l2 = 0.0;
  for (var j = 0; j < AQ_TAPS; j = j + 1) {
    for (var i = 0; i < AQ_TAPS; i = i + 1) {
      let off = vec2<f32>(f32(i), f32(j)) * step * sgn;
      let c = textureSample(srcTexture, srcSampler, mirrorUv(uv + off)).rgb;
      m = m + c;
      let l = aqLuma(c);
      lsum = lsum + l;
      l2 = l2 + l * l;
    }
  }
  let inv = 1.0 / f32(AQ_TAPS * AQ_TAPS);
  let mean = lsum * inv;
  let variance = max(l2 * inv - mean * mean, 0.0);
  return vec4<f32>(m * inv, variance);
}

fn aqKuwahara(uv: vec2<f32>, dims: vec2<f32>, radiusTexels: f32) -> vec3<f32> {
  let r = max(radiusTexels, 1.0);
  // Le dernier tap d'un secteur (indice AQ_TAPS-1) tombe a r texels : step = r/(N-1).
  let step = (1.0 / dims) * (r / f32(AQ_TAPS - 1));
  let s0 = aqSector(uv, step, vec2<f32>( 1.0,  1.0));
  let s1 = aqSector(uv, step, vec2<f32>(-1.0,  1.0));
  let s2 = aqSector(uv, step, vec2<f32>( 1.0, -1.0));
  let s3 = aqSector(uv, step, vec2<f32>(-1.0, -1.0));
  // Poids qui privilegie FORT le secteur homogene : 1/(variance+eps)^3. Sur un
  // aplat les 4 poids sont egaux et grands -> moyenne des 4 (plat). Pres d'un
  // bord, le secteur du cote plat gagne -> couleur franche, bord net.
  let w0 = 1.0 / pow(s0.w + 0.0001, 3.0);
  let w1 = 1.0 / pow(s1.w + 0.0001, 3.0);
  let w2 = 1.0 / pow(s2.w + 0.0001, 3.0);
  let w3 = 1.0 / pow(s3.w + 0.0001, 3.0);
  let sum = s0.xyz * w0 + s1.xyz * w1 + s2.xyz * w2 + s3.xyz * w3;
  return sum / max(w0 + w1 + w2 + w3, 1e-4);
}
`;

// Champ de mouille W (pre-seuil), lu par le composite : basse freq (~6 cycles sur
// la largeur) plus HF pour la dentelle du front, TOUTES relatives a l'image via
// aspectScale (ar).
const AQ_WET_WGSL = `
fn aqWet(uv: vec2<f32>, ar: vec2<f32>, lace: f32) -> f32 {
  let low = aq_fbm(uv * ar * 6.0, 3);
  let hi = aq_fbm(uv * ar * 90.0, 2);
  return clamp(low + (hi - 0.5) * 0.35 * lace, 0.0, 1.0);
}
`;

// CARTE DE FRONTIERES E, lue par le composite sur la texture DIFFUSEE (prevPass).
// Un anneau de 8 taps au rayon r = bleedFrac * largeur : on prend la difference
// RGB MAXIMALE entre le centre et l'anneau. Interieur plat -> 0 exact ; a moins
// de r d'une frontiere entre deux lavis, l'anneau traverse vers l'autre couleur
// -> difference non nulle. C'est une DILATATION de la frontiere a la largeur r.
// L'ecartement est isotrope en px (offset px / dims, comme edge_spacing) : pas de
// correction d'aspect en plus, qui serait une double correction. La forme finale
// sature vite (meme une frontiere douce leve E) et se dentelle par HF.
const AQ_BOUNDARY_WGSL = `
fn aqBoundary(uv: vec2<f32>, dims: vec2<f32>, ar: vec2<f32>, bleedFrac: f32, lace: f32) -> f32 {
  let c0 = textureSample(prevPass, srcSampler, uv).rgb;
  let s = vec2<f32>(bleedFrac * dims.x) / dims;
  let d = s * 0.7071;
  var maxd = 0.0;
  maxd = max(maxd, distance(textureSample(prevPass, srcSampler, mirrorUv(uv + vec2<f32>( s.x, 0.0))).rgb, c0));
  maxd = max(maxd, distance(textureSample(prevPass, srcSampler, mirrorUv(uv + vec2<f32>(-s.x, 0.0))).rgb, c0));
  maxd = max(maxd, distance(textureSample(prevPass, srcSampler, mirrorUv(uv + vec2<f32>( 0.0, s.y))).rgb, c0));
  maxd = max(maxd, distance(textureSample(prevPass, srcSampler, mirrorUv(uv + vec2<f32>( 0.0,-s.y))).rgb, c0));
  maxd = max(maxd, distance(textureSample(prevPass, srcSampler, mirrorUv(uv + vec2<f32>( d.x, d.y))).rgb, c0));
  maxd = max(maxd, distance(textureSample(prevPass, srcSampler, mirrorUv(uv + vec2<f32>(-d.x, d.y))).rgb, c0));
  maxd = max(maxd, distance(textureSample(prevPass, srcSampler, mirrorUv(uv + vec2<f32>( d.x,-d.y))).rgb, c0));
  maxd = max(maxd, distance(textureSample(prevPass, srcSampler, mirrorUv(uv + vec2<f32>(-d.x,-d.y))).rgb, c0));
  var e = smoothstep(0.02, 0.16, maxd);
  // Dentelle de la frontiere par HF relative : le bord d'une bave n'est jamais lisse.
  let lc = aq_fbm(uv * ar * 130.0, 3);
  e = e * mix(1.0, clamp(lc * 1.8, 0.0, 1.0), lace);
  return clamp(e, 0.0, 1.0);
}
`;

// PAPIER BLANC : reduction de DENSITE (absorbance) avec un genou tonal. La densite
// A = -log(c) est reduite d'un facteur (1 - paper*k*w) ou w depend du TON : proche
// de 1 pour les clairs (ils vont franchement au blanc), petit pour les sombres (ils
// gardent leur teinte, ne s'allegent qu'un peu). Le facteur etant scalaire par
// pixel, tous les canaux sont reduits ensemble -> la TEINTE est preservee
// (c' = c^(1-paper*k*w)).
const AQ_PAPER_WGSL = `
fn aqPaper(c: vec3<f32>, paper: f32) -> vec3<f32> {
  if (paper <= 0.0) { return c; }
  let lum = clamp(aqLuma(c), 0.0, 1.0);
  // Genou : clairs (w~1) reduits fort, sombres (w~0.25) reduits peu.
  let w = mix(0.25, 1.0, pow(lum, 0.7));
  let k = 0.9;
  let A = -log(max(c, vec3<f32>(1e-4)));
  let A2 = A * (1.0 - clamp(paper, 0.0, 1.0) * k * w);
  return clamp(exp(-A2), vec3<f32>(0.0), vec3<f32>(1.0));
}
`;

// Potentiel HAUTE FREQUENCE pour les fibres, RELATIF a l'image (aspectScale) : le
// curl (perpendiculaire du gradient) donne des tourbillons COURTS a l'echelle HF,
// soit des tendrilles fines, pas des langues. SANS terme basse frequence (c'est
// lui qui faisait les vortex de v2).
const AQ_POT_WGSL = `
fn aqPotHF(uv: vec2<f32>, ar: vec2<f32>, ph: vec2<f32>) -> f32 {
  return aq_fbm(uv * ar * 110.0 + ph, 2);
}
`;

// LE LAVIS, passe a scale 0.25. Abstrait la source en aplats par Kuwahara, melange
// par wash. La bave lit ce lavis ; le composite recalcule un Kuwahara pleine res
// pour son cote sec. Rayon = washRadius % * dims.x (dims = dims de CETTE passe, donc
// dims.x = largeur/4 a scale 0.25 -> rayon natif = washRadius % * largeur).
const AQ_WASH_PASS_WGSL = `
${AQ_COMMON_WGSL}
${AQ_KUWAHARA_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let washAmt = clamp(params[0], 0.0, 1.0);
  let washFrac = clamp(params[1], 0.0005, 0.05);
  let radiusTexels = washFrac * dims.x;
  let lavis = aqKuwahara(uv, dims, radiusTexels);
  return vec4<f32>(mix(color.rgb, lavis, washAmt), 1.0);
}
`;

// UNE PASSE DE FIBRES : advecte l'entree le long du curl d'un potentiel HF, petite
// amplitude, UNIQUEMENT aux frontieres locales (le deplacement est multiplie par
// une estimation de bord tiree du gradient de la propre entree de la passe, donc
// l'interieur d'un lavis ne bouge pas). `fibers` (params[4]) est l'amplitude TOTALE
// en % de largeur, repartie sur 3 passes (donc /3 ici). La phase HF est un decalage
// FIXE par passe, injecte hors commentaire (le runner ne fournit pas d'index de passe).
function fiberPassWgsl(k: number): string {
  const phx = (k * 0.33 + 0.15).toFixed(4);
  const phy = (k * 0.27 + 0.11).toFixed(4);
  return `
${AQ_COMMON_WGSL}
${AQ_POT_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  // Amplitude par passe = fibers % de la largeur / 3 passes, exprimee en UV.
  let ampUv = clamp(params[4], 0.0, 0.02) / 3.0;
  let ph = vec2<f32>(${phx}, ${phy});
  // Frontiere LOCALE : gradient de luminance de l'entree, sur un ecartement court.
  // Interieur plat -> localEdge ~ 0 -> aucun deplacement.
  let g = 2.0 / dims;
  let gl = aqLuma(textureSample(srcTexture, srcSampler, mirrorUv(uv - vec2<f32>(g.x, 0.0))).rgb);
  let gr = aqLuma(textureSample(srcTexture, srcSampler, mirrorUv(uv + vec2<f32>(g.x, 0.0))).rgb);
  let gd = aqLuma(textureSample(srcTexture, srcSampler, mirrorUv(uv - vec2<f32>(0.0, g.y))).rgb);
  let gu = aqLuma(textureSample(srcTexture, srcSampler, mirrorUv(uv + vec2<f32>(0.0, g.y))).rgb);
  let localEdge = clamp(length(vec2<f32>(gr - gl, gu - gd)) * 8.0, 0.0, 1.0);
  let e = 1.5 / dims;
  let px = aqPotHF(uv + vec2<f32>(e.x, 0.0), ar, ph) - aqPotHF(uv - vec2<f32>(e.x, 0.0), ar, ph);
  let py = aqPotHF(uv + vec2<f32>(0.0, e.y), ar, ph) - aqPotHF(uv - vec2<f32>(0.0, e.y), ar, ph);
  let curl = vec2<f32>(py, -px);
  let dir = curl / (length(curl) + 0.02);
  // Deplacement isotrope en pixels : ampUv est corrige de l'aspect par /ar, et
  // module par la frontiere locale (fibres seulement aux bords).
  let off = dir * (ampUv / ar) * localEdge;
  var col = textureSample(srcTexture, srcSampler, mirrorUv(uv - off)).rgb;
  let d = 1.5 / dims;
  var nb = textureSample(srcTexture, srcSampler, mirrorUv(uv + vec2<f32>(d.x, 0.0))).rgb;
  nb = nb + textureSample(srcTexture, srcSampler, mirrorUv(uv - vec2<f32>(d.x, 0.0))).rgb;
  nb = nb + textureSample(srcTexture, srcSampler, mirrorUv(uv + vec2<f32>(0.0, d.y))).rgb;
  nb = nb + textureSample(srcTexture, srcSampler, mirrorUv(uv - vec2<f32>(0.0, d.y))).rgb;
  // La diffusion 4-voisins est elle aussi bornee au bord (interieur inchange).
  col = mix(col, nb * 0.25, 0.15 * localEdge);
  return vec4<f32>(col, 1.0);
}
`;
}

export const aquarelle: EffectModule = {
  id: "aquarelle",
  name: "Aquarelle",
  params: [
    { name: "wash", label: "Lavis", unit: "percent", min: 0, max: 1, default: 0.85, step: 0.01, hint: "Abstrait la photo en aplats à bords nets (Kuwahara), avant la bave. 0 = part de la photo. Ce n'est pas un flou : les régions deviennent plates mais les bords restent tranchés" },
    { name: "washRadius", label: "Grain du lavis (% largeur)", unit: "percent", min: 0.001, max: 0.02, default: 0.005, step: 0.001, hint: "Taille des aplats du lavis, en % de la largeur de l'image (défaut ≈ 30 px à 6240). Relatif à l'image : visible en vignette à toute résolution" },
    { name: "spread", label: "Portée de la bave", unit: "none", min: 0.4, max: 3.5, default: 2, step: 0.05, hint: "Écartement des taps de remontée de la pyramide de diffusion (1/8). Plus la portée est grande, plus la couleur fond loin dans la bande de frontière" },
    { name: "wetness", label: "Mouillé", unit: "percent", min: 0, max: 1, default: 0.7, step: 0.01, hint: "Seuil du champ de mouillé : module la bave par plages. À 1 toutes les frontières bavent ; en dessous seules certaines plages bavent. La bave reste TOUJOURS locale aux frontières (voir Largeur de bave). 0 = pas de bave, le lavis reste net" },
    { name: "fibers", label: "Fibres (% largeur)", unit: "percent", min: 0, max: 0.02, default: 0.0015, step: 0.0005, hint: "Effilochage capillaire des frontières : advection le long d'un flux haute fréquence, amplitude en % de la largeur répartie sur 3 passes (défaut ≈ 9 px à 6240). Tendrilles courtes, seulement aux bords des lavis. 0 = frontières sans fibres" },
    { name: "edgeDarkening", label: "Front de pigment", unit: "none", min: 0, max: 2, default: 0.9, step: 0.05, hint: "Le pigment s'accumule au BORD DES LAVIS de la version bavée (là où une couleur s'arrête) : assombrit et sature une bande étroite. 0 = pas de front" },
    { name: "frontWidth", label: "Largeur du front (% largeur)", unit: "percent", min: 0.0005, max: 0.01, default: 0.003, step: 0.0005, hint: "Largeur de la bande où le pigment s'accumule au bord, en % de la largeur (défaut ≈ 19 px à 6240)" },
    { name: "lace", label: "Dentelle du front", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, hint: "Découpe le front et la carte de frontières en dentelle irrégulière (bruit haute fréquence). 0 = bord lisse" },
    { name: "bloom", label: "Éclaircissement", unit: "percent", min: 0, max: 1, default: 0.15, step: 0.01, hint: "Le centre d'une bavure s'éclaircit un peu (l'eau repousse le pigment), sans dépasser le max local. 0 = le pigment n'assombrit que" },
    { name: "paper", label: "Papier blanc", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Rend l'image transparente sur papier blanc : les hautes lumières deviennent le papier nu, les tons moyens s'éclaircissent, les noirs profonds gardent leur teinte en s'allégeant un peu. Réduction de densité, pas une texture. 0 = densité photo" },
    { name: "bleedWidth", label: "Largeur de bave (% largeur)", unit: "percent", min: 0.002, max: 0.06, default: 0.02, step: 0.002, hint: "Largeur de la bande où la couleur bave, à la frontière entre deux lavis, en % de la largeur de l'image (défaut ≈ 125 px à 6240). L'intérieur des lavis reste plat. Petit = bave fine au ras du bord ; grand = deux couleurs qui se mangent largement" },
  ],
  // CHAINE : lavis (scale 0.25) -> bave 1/8 (down 0.5, 0.25, 0.125 ; up 0.25, 0.5)
  // -> fibres (3x scale 0.5) -> composite (wgsl). Chaque etage saute quand son
  // curseur est a 0, laissant la texture precedente passer telle quelle.
  passes: [
    { scale: 0.25, wgsl: AQ_WASH_PASS_WGSL, enabled: (p) => p.wash > 0 },
    { scale: 0.5, wgsl: DOWNSAMPLE_WGSL, enabled: (p) => p.wetness > 0 },
    { scale: 0.25, wgsl: DOWNSAMPLE_WGSL, enabled: (p) => p.wetness > 0 },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL, enabled: (p) => p.wetness > 0 },
    { scale: 0.25, wgsl: upsampleWgsl(2), enabled: (p) => p.wetness > 0 },
    { scale: 0.5, wgsl: upsampleWgsl(2), enabled: (p) => p.wetness > 0 },
    { scale: 0.5, wgsl: fiberPassWgsl(0), enabled: (p) => p.fibers > 0 },
    { scale: 0.5, wgsl: fiberPassWgsl(1), enabled: (p) => p.fibers > 0 },
    { scale: 0.5, wgsl: fiberPassWgsl(2), enabled: (p) => p.fibers > 0 },
  ],
  sections: [
    { id: "lavis", label: "Lavis", layout: "liste", params: ["wash", "washRadius"] },
    { id: "bave", label: "Bave", layout: "liste", params: ["spread", "wetness", "bleedWidth"] },
    { id: "fibres", label: "Fibres", layout: "liste", params: ["fibers"] },
    { id: "front", label: "Front", layout: "liste", params: ["edgeDarkening", "frontWidth", "lace"] },
    { id: "rendu", label: "Rendu", layout: "liste", params: ["bloom", "paper"] },
  ],
  wgsl: `
${AQ_COMMON_WGSL}
${AQ_KUWAHARA_WGSL}
${AQ_WET_WGSL}
${AQ_BOUNDARY_WGSL}
${AQ_PAPER_WGSL}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  let washAmt = clamp(params[0], 0.0, 1.0);
  let washFrac = clamp(params[1], 0.0005, 0.05);
  let wetness = clamp(params[3], 0.0, 1.0);
  let edgeK = clamp(params[5], 0.0, 2.0);
  let frontFrac = clamp(params[6], 0.0002, 0.02);
  let lace = clamp(params[7], 0.0, 1.0);
  let bloom = clamp(params[8], 0.0, 1.0);
  let paper = clamp(params[9], 0.0, 1.0);
  let bleedFrac = clamp(params[10], 0.001, 0.08);
  let lw = vec3<f32>(0.2126, 0.7152, 0.0722);

  let src = color.rgb;
  // SEC (net dehors) : Kuwahara PLEINE RESOLUTION au meme rayon natif que le lavis.
  // A wash 0 -> source nette. Voir DECISION SEC dans l'en-tete.
  let lavis = aqKuwahara(uv, dims, washFrac * dims.x);
  let dry = mix(src, lavis, washAmt);
  // MOUILLE (dedans) : bout de la chaine (lavis bave + fibre).
  let wet = textureSample(prevPass, srcSampler, uv).rgb;

  // CARTE DE FRONTIERES E : 1 pres d'une frontiere entre deux lavis, 0 a
  // l'interieur, dilatee sur bleedFrac. La bave ne vit qu'ici.
  let E = aqBoundary(uv, dims, ar, bleedFrac, lace);

  // CHAMP DE MOUILLE et son SEUIL : module E par plages. A wetness 1 le seuil est
  // 0, donc toutes les frontieres bavent ; en dessous seules certaines plages.
  let W = aqWet(uv, ar, lace);
  let thr = 1.0 - wetness;
  let wetMask = smoothstep(thr - 0.06, thr + 0.06, W);

  // POIDS DE BAVE, LOCAL : wetness * E * plages. Interieur (E=0) -> 0 -> dry intact.
  let blend = clamp(wetness * E * wetMask, 0.0, 1.0);

  // COMPOSITE dry <-> wet en ABSORBANCE (moyenne geometrique en lineaire), jamais
  // log(0). Preserve les noirs bien mieux que la moyenne arithmetique.
  let ld = log(max(dry, vec3<f32>(1e-4)));
  let lwet = log(max(wet, vec3<f32>(1e-4)));
  var base = exp(mix(ld, lwet, blend));

  // FRONT DE PIGMENT au bord des lavis de la version bavee : gradient de luminance
  // de prevPass sur une bande de largeur RELATIVE (frontFrac). Naturellement aux
  // frontieres (le gradient y est non nul), gate par la bave locale.
  let sp = (frontFrac * dims.x) / dims;
  let bl = aqLuma(textureSample(prevPass, srcSampler, mirrorUv(uv - vec2<f32>(sp.x, 0.0))).rgb);
  let br = aqLuma(textureSample(prevPass, srcSampler, mirrorUv(uv + vec2<f32>(sp.x, 0.0))).rgb);
  let bd = aqLuma(textureSample(prevPass, srcSampler, mirrorUv(uv - vec2<f32>(0.0, sp.y))).rgb);
  let bu = aqLuma(textureSample(prevPass, srcSampler, mirrorUv(uv + vec2<f32>(0.0, sp.y))).rgb);
  let frontEdge = clamp(length(vec2<f32>(br - bl, bu - bd)) * 6.0, 0.0, 1.0);
  // dentelle par HF relative.
  let lc = aq_fbm(uv * ar * 130.0, 3);
  let laceMod = mix(1.0, lc * 1.7, lace);
  // Le front ne vit que dans la bave locale : gate par blend (0 a l'interieur).
  var front = edgeK * frontEdge * laceMod * blend;
  front = clamp(front, 0.0, 0.85);

  // Assombrit, puis sature (eloigne de sa propre luminance). Borne bas a 0.
  var outc = base * (1.0 - front);
  let lum = dot(outc, lw);
  outc = max(mix(vec3<f32>(lum), outc, 1.0 + 0.5 * front), vec3<f32>(0.0));

  // BLOOM faible : le centre d'une bavure s'eclaircit, borne au max local, LOCAL.
  let lite = max(dry, wet);
  outc = mix(outc, lite, bloom * blend * 0.4);
  outc = min(outc, lite + bloom);

  // PAPIER BLANC en dernier : reduction de densite en absorbance, genou tonal.
  outc = aqPaper(outc, paper);

  return vec4<f32>(outc, color.a);
}
`,
};

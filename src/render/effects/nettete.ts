import type { EffectModule } from "./types";
import { DOWNSAMPLE_WGSL, upsampleWgsl } from "./blurChain";

/**
 * Netteté — accentuation et clarté, un seul opérateur à deux bandes.
 *
 * CE QUE C'EST. Le squelette est celui de toute la famille :
 *
 *     sortie = entrée + k · (entrée − flou(entrée))
 *
 * Ce qui distingue accentuation, texture et clarté n'est PAS l'opérateur mais la
 * BANDE DE FRÉQUENCE SPATIALE sur laquelle il agit — c'est l'équipe Camera Raw
 * qui le pose en ces termes en présentant le curseur Texture :
 * <https://blog.adobe.com/en/publish/2019/05/14/from-the-acr-team-introducing-the-texture-control>
 * (« Texture is best for making subtle adjustments to those mid-frequency
 * features » ; « Clarity … a broader frequency range, including some lower
 * frequencies »). D'où un effet et non trois : trois entrées de registre
 * auraient recopié trois fois la même soustraction pour ne changer qu'un rayon.
 *
 * POURQUOI IL ARRIVE MAINTENANT. Il était donné « DOUBLEMENT bloqué » — pas de
 * mode de fusion signé, et un effet ne peut lire aucun autre calque. Les deux
 * blocages étaient faux, et c'est `glow` qui l'a montré : son dernier pass tient
 * DÉJÀ les deux images, `color` (son entrée non floutée) et `prevPass` (sa
 * pyramide). La soustraction a donc lieu DANS l'effet, entre deux échelles de sa
 * PROPRE entrée. Rien à ouvrir (ticket 12).
 *
 * ── LES DEUX BANDES, ET POURQUOI ELLES NE PARTAGENT PAS LEUR FLOU ───────────
 *
 * `EffectModule.passes` est un tableau STATIQUE : le nombre de passes ne peut
 * pas dépendre d'un paramètre. Mais `EffectPass.enabled` peut les ÉTEINDRE, et
 * le runner documente ce qui arrive alors — « un mode dont TOUTES les passes
 * sautent reçoit la texture SOURCE en `prevPass` » (`effectPassRunner.ts:247`).
 * C'est ce qui rend les deux bandes possibles dans un seul effet :
 *
 *   Accentuation — les sept passes sautent, `prevPass` EST la source, et le flou
 *                  se fait ICI, en tente 3x3 à UN texel plein cadre. Rayon ~1 px,
 *                  la bande la plus haute qui existe. Coût : 9 lectures, zéro
 *                  passe, zéro allocation.
 *   Clarté       — la pyramide tourne (descente à 1/16, remontée symétrique) et
 *                  `prevPass` porte un flou large, lu en UNE tap. Le rayon est
 *                  réglable par l'écartement des taps de remontée, exactement
 *                  comme la portée de `glow`.
 *
 * Le curseur de rayon n'a donc de sens qu'en Clarté, et il le déclare
 * (`appliesWhen`) : en Accentuation le rayon est celui du texel, il n'y a rien à
 * régler. C'est la forme que le chantier des contrôles réclame, posée à
 * l'écriture plutôt que dans un lot de rattrapage.
 *
 * ── LA BARRE DE QUALITÉ : LE LISERÉ ─────────────────────────────────────────
 *
 * Un unsharp mask naïf pose un liseré clair le long des bords francs, et c'est
 * exactement le « filtre Photoshop 2005 » que le dépôt refuse. Trois choses le
 * tiennent ici, et aucune n'est un dosage :
 *
 * 1. **Maîtrise des halos** — le détail passe par un compresseur doux
 *    `limite · a / (limite + a)`, qui laisse les petites amplitudes intactes et
 *    borne les grandes. Un bord franc est précisément une grande amplitude : le
 *    compresseur l'empêche de doubler sa marche, là où un simple `clamp`
 *    créerait un palier visible.
 * 2. **Masquage** — sous un seuil d'amplitude, le gain retombe à zéro. C'est là
 *    que vit le bruit : accentuer une zone plate, c'est accentuer son grain de
 *    capteur, et rien d'autre.
 * 3. **Luminance seule** — le détail est mesuré et réappliqué sur la LUMINANCE.
 *    Accentuer les canaux séparément fait des franges colorées sur les bords, le
 *    JPEG portant déjà du bruit chromatique.
 *
 * ⚠️ La correction est ADDITIVE (`color.rgb + gain`) et non multiplicative
 * (`color.rgb · (1 + gain/luma)`), qui préserverait pourtant la chromaticité
 * exactement. La forme multiplicative EXPLOSE dans les ombres — un facteur
 * `sortie/entrée` a atteint 250 sur le canal maître de `curves` (2026-08-13) et
 * amplifiait le bruit chromatique du JPEG. Le même piège, sous un autre nom.
 * L'additif décale légèrement la saturation aux extrêmes ; il ne diverge nulle
 * part.
 *
 * ── CE QUE CET EFFET NE COUVRE PAS, ET C'EST DIT PLUTÔT QUE DÉCOUVERT ───────
 *
 * La clarté d'Adobe change la luminance ET la saturation ; ici, la luminance
 * seule. Et le rayon maximum de la bande Clarté est borné par la profondeur de
 * la pyramide, qui est fixe : mesuré ci-dessous, pas prédit.
 */

/** La pyramide ne sert QUE la bande Clarté. En Accentuation elle est éteinte,
 *  et le flou se fait en tente 3x3 dans la passe finale. */
const enClarte = (params: Record<string, number>) => params.bande >= 0.5;

/** Poids Rec.709, les mêmes qu'en WGSL et que partout ailleurs dans `effects/`. */
const POIDS = [0.2126, 0.7152, 0.0722] as const;

/**
 * Jumeau TS de l'opérateur, une fois le flou connu.
 *
 * Il commence là où le shader a fini de LIRE : `flou` est ce que la tente 3x3
 * (bande Accentuation) ou la pyramide (bande Clarté) a produit. L'échantillonnage
 * est le travail du GPU et n'est pas une couture ; ce qui suit — détail,
 * masquage, compression, application — est de la logique pure, et c'est elle
 * qui tient la barre de qualité.
 *
 * ⚠️ DEUX IMPLÉMENTATIONS, RIEN NE LES RELIE AUTOMATIQUEMENT. Même contrat que
 * `curvesSpec`/`curve_eval` et que `inputDriver`/`input_driver` : toute
 * modification de la formule se fait des DEUX côtés, et c'est
 * `npm run test:render` qui attrape un oubli.
 *
 * @param entree couleur LINÉAIRE du pixel
 * @param flou   couleur LINÉAIRE du même pixel, passée au flou de la bande
 * @param params valeurs résolues, dans l'ordre de `nettete.params`
 */
export function netteteSpec(
  entree: readonly [number, number, number],
  flou: readonly [number, number, number],
  params: readonly number[],
): [number, number, number] {
  const force = params[1];
  const masquage = params[3];
  const maitrise = params[4];
  const luma = (c: readonly [number, number, number]) =>
    c[0] * POIDS[0] + c[1] * POIDS[1] + c[2] * POIDS[2];
  const d = luma(entree) - luma(flou);
  const a = Math.abs(d);
  // MASQUAGE. Rampe douce et non bascule : une frontière dure se VERRAIT entre
  // la zone accentuée et la zone épargnée. Au repos le seuil tombe à 1e-5, donc
  // le masque vaut 1 partout et le curseur ne coûte rien.
  const seuil = Math.max(masquage * 0.15, 1e-5);
  const t = Math.min(1, Math.max(0, a / seuil));
  const masque = t * t * (3 - 2 * t);
  // Compresseur doux : ~a quand a << limite, tend vers limite au-delà. Continu
  // et strictement croissant partout — ce qu'un `min` n'est pas, et c'est toute
  // la différence : un plafond aplatirait le modelé en palier là où celui-ci
  // continue de distinguer deux bords d'amplitudes voisines.
  const limite = 0.02 + (0.5 - 0.02) * maitrise;
  const detail = Math.sign(d) * ((limite * a) / (limite + a));
  const gain = detail * force * masque;
  // Plancher PAR CANAL : une valeur négative en lumière linéaire n'a pas de sens,
  // et le ré-encodage sRGB en ferait un NaN (`pow` d'une base négative), donc un
  // pixel mort plutôt qu'un pixel sombre.
  return [
    Math.max(entree[0] + gain, 0),
    Math.max(entree[1] + gain, 0),
    Math.max(entree[2] + gain, 0),
  ];
}

export const nettete: EffectModule = {
  id: "nettete",
  name: "Netteté",
  params: [
    {
      name: "bande",
      label: "Bande",
      unit: "none",
      min: 0,
      max: 1,
      default: 0,
      step: 1,
      choices: ["Accentuation", "Clarté"],
      hint: "La bande de fréquence, seule chose qui distingue les opérateurs de cette famille. Accentuation prend le détail au pixel ; Clarté prend le modelé large",
    },
    // NÉGATIF ADMIS, et ce n'est pas une symétrie gratuite : une clarté négative
    // est le look « diffusion » de la postproduction — le modelé s'aplatit, la
    // peau s'adoucit sans que les bords se déplacent. La course haute s'arrête à
    // 2 : au-delà, le compresseur de halos travaille tout le temps et le curseur
    // cesse de rendre ce qu'il annonce.
    { name: "force", label: "Force", unit: "none", min: -1, max: 2, default: 0.6, step: 0.05, hint: "Négatif = adoucir le modelé au lieu de le creuser" },
    {
      name: "rayon",
      label: "Rayon",
      unit: "none",
      min: 0.2,
      max: 4,
      default: 1,
      step: 0.05,
      // En Accentuation le flou est la tente d'un texel : il n'y a pas de rayon
      // à régler, et un curseur qui ne fait rien est l'échec silencieux que ce
      // dépôt proscrit.
      appliesWhen: { param: "bande", equals: 1 },
      hint: "Écartement des taps de remontée. Il fixe la largeur du modelé que la clarté attrape",
    },
    { name: "masquage", label: "Masquage", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, hint: "Épargne les zones plates, où il n'y a que du bruit à accentuer. C'est le Masking de Lightroom" },
    { name: "halos", label: "Maîtrise des halos", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Bas = les bords francs ne peuvent pas doubler leur marche ; haut = le détail passe presque intact" },
  ],
  passes: [
    { scale: 0.5, wgsl: DOWNSAMPLE_WGSL, enabled: enClarte },
    { scale: 0.25, wgsl: DOWNSAMPLE_WGSL, enabled: enClarte },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL, enabled: enClarte },
    { scale: 0.0625, wgsl: DOWNSAMPLE_WGSL, enabled: enClarte },
    // Index 2 = `rayon`. Passé en argument plutôt qu'écrit en dur dans le noyau
    // partagé : glow, halation et cet effet n'ont pas la même liste.
    { scale: 0.125, wgsl: upsampleWgsl(2), enabled: enClarte },
    { scale: 0.25, wgsl: upsampleWgsl(2), enabled: enClarte },
    { scale: 0.5, wgsl: upsampleWgsl(2), enabled: enClarte },
  ],
  sections: [
    // La bande d'abord : c'est elle qui décide si le rayon existe.
    { id: "bande", label: "Bande", layout: "liste", params: ["bande", "rayon"] },
    { id: "dose", label: "Dose", layout: "liste", params: ["force", "masquage", "halos"] },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let bande = params[0];
  let force = params[1];
  let masquage = params[3];
  let maitrise = params[4];

  // LE FLOU. Les deux branches lisent \`prevPass\`, qui n'est PAS la même texture
  // dans les deux cas — source pleine résolution quand la pyramide est éteinte,
  // dernier niveau de remontée sinon. La condition vient d'un uniform, donc le
  // branchement est uniforme sur toute la passe.
  var flou = vec3<f32>(0.0);
  if (bande < 0.5) {
    // Tente 3x3 canonique (1-2-1 / 2-4-2 / 1-2-1) à UN texel. Pas de repli de
    // bord : au périmètre, le sampler rend le même texel des deux côtés, donc
    // le détail y tombe à zéro. C'est le comportement voulu — un liseré sur le
    // cadre serait pire que pas d'accentuation sur sa dernière rangée.
    let texel = 1.0 / vec2<f32>(textureDimensions(prevPass));
    var sum = textureSample(prevPass, srcSampler, uv).rgb * 4.0;
    sum = sum + textureSample(prevPass, srcSampler, uv + vec2<f32>(-texel.x, 0.0)).rgb * 2.0;
    sum = sum + textureSample(prevPass, srcSampler, uv + vec2<f32>( texel.x, 0.0)).rgb * 2.0;
    sum = sum + textureSample(prevPass, srcSampler, uv + vec2<f32>(0.0, -texel.y)).rgb * 2.0;
    sum = sum + textureSample(prevPass, srcSampler, uv + vec2<f32>(0.0,  texel.y)).rgb * 2.0;
    sum = sum + textureSample(prevPass, srcSampler, uv + vec2<f32>(-texel.x, -texel.y)).rgb;
    sum = sum + textureSample(prevPass, srcSampler, uv + vec2<f32>( texel.x, -texel.y)).rgb;
    sum = sum + textureSample(prevPass, srcSampler, uv + vec2<f32>(-texel.x,  texel.y)).rgb;
    sum = sum + textureSample(prevPass, srcSampler, uv + vec2<f32>( texel.x,  texel.y)).rgb;
    flou = sum / 16.0;
  } else {
    flou = textureSample(prevPass, srcSampler, uv).rgb;
  }

  // LE DÉTAIL, sur la luminance seule. Coefficients Rec.709 en LINÉAIRE, comme
  // partout ailleurs dans ce dépôt : le format -srgb décode a l'echantillonnage,
  // aucun gamma manuel n'entre en WGSL ici.
  let poids = vec3<f32>(0.2126, 0.7152, 0.0722);
  let d = dot(color.rgb, poids) - dot(flou, poids);
  let a = abs(d);

  // MASQUAGE. \`smoothstep\` et non un seuil dur : une bascule laisserait une
  // frontiere visible entre la zone accentuee et la zone epargnee, ce qui est
  // exactement le defaut qu'on vient eviter. A masquage nul le seuil vaut 1e-5,
  // donc le masque vaut 1 partout — le curseur au repos ne coute rien.
  let seuil = masquage * 0.15;
  let masque = smoothstep(0.0, max(seuil, 0.00001), a);

  // MAITRISE DES HALOS. Compresseur doux : \`limite·a/(limite+a)\` vaut ~a quand
  // a << limite, et tend vers limite quand a la depasse. Continu et a derivee
  // continue, donc aucun palier — ce qu'un \`min\` produirait.
  let limite = mix(0.02, 0.5, maitrise);
  let detail = sign(d) * (limite * a / (limite + a));

  let gain = detail * force * masque;
  // Meme decalage sur les trois canaux : la teinte ne bouge pas. Plancher a 0 —
  // une force negative sur un pixel deja noir passerait sous zero, et une valeur
  // negative en lineaire n'a pas de sens (elle ressortirait en NaN au
  // re-encodage sRGB).
  return vec4<f32>(max(color.rgb + vec3<f32>(gain), vec3<f32>(0.0)), color.a);
}
`,
};
